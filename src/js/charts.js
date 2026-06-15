import { RoomTypeLabels, RoomTypes } from './state.js';

function createSVG(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function renderTrendChart(container, data) {
  container.innerHTML = '';
  if (!data || data.length === 0) {
    container.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:40px;">暂无数据</p>';
    return;
  }
  const width = 900;
  const height = 340;
  const padding = { top: 30, right: 30, bottom: 50, left: 60 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const svg = createSVG('svg', { width: '100%', height, viewBox: `0 0 ${width} ${height}` });
  svg.style.fontFamily = 'PingFang SC, system-ui, sans-serif';
  const defs = createSVG('defs');
  const grad1 = createSVG('linearGradient', { id: 'gRev', x1: '0', y1: '0', x2: '0', y2: '1' });
  grad1.innerHTML = '<stop offset="0%" stop-color="#d4af37" stop-opacity="0.3"/><stop offset="100%" stop-color="#d4af37" stop-opacity="0"/>';
  defs.appendChild(grad1);
  svg.appendChild(defs);
  const revMax = Math.max(...data.map(d => d.revenue), 1);
  const occMax = 1;
  const adrMax = Math.max(...data.map(d => d.adr), 1);
  const xStep = data.length > 1 ? chartW / (data.length - 1) : chartW;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartH / 4) * i;
    const line = createSVG('line', {
      x1: padding.left, y1: y, x2: padding.left + chartW, y2: y,
      stroke: '#e2e8f0', 'stroke-width': 1
    });
    svg.appendChild(line);
    const label = createSVG('text', {
      x: padding.left - 8, y: y + 4, 'text-anchor': 'end',
      fill: '#94a3b8', 'font-size': 11
    });
    label.textContent = `¥${Math.round(revMax - (revMax / 4) * i).toLocaleString()}`;
    svg.appendChild(label);
  }
  data.forEach((d, i) => {
    if (i % 5 !== 0 && i !== data.length - 1) return;
    const x = padding.left + xStep * i;
    const label = createSVG('text', {
      x, y: height - padding.bottom + 20, 'text-anchor': 'middle',
      fill: '#94a3b8', 'font-size': 11
    });
    label.textContent = d.date.slice(5);
    svg.appendChild(label);
  });
  const revPath = data.map((d, i) => {
    const x = padding.left + xStep * i;
    const y = padding.top + chartH * (1 - d.revenue / revMax);
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');
  const areaPath = revPath + ` L${padding.left + xStep * (data.length - 1)},${padding.top + chartH} L${padding.left},${padding.top + chartH} Z`;
  const area = createSVG('path', { d: areaPath, fill: 'url(#gRev)' });
  svg.appendChild(area);
  const revLine = createSVG('path', {
    d: revPath, fill: 'none', stroke: '#d4af37',
    'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
  });
  svg.appendChild(revLine);
  const adrPath = data.map((d, i) => {
    const x = padding.left + xStep * i;
    const y = padding.top + chartH * (1 - d.adr / adrMax);
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');
  const adrLine = createSVG('path', {
    d: adrPath, fill: 'none', stroke: '#3b82f6',
    'stroke-width': 2, 'stroke-dasharray': '5,3', 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
  });
  svg.appendChild(adrLine);
  const occPath = data.map((d, i) => {
    const x = padding.left + xStep * i;
    const y = padding.top + chartH * (1 - d.occupancy / occMax);
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');
  const occLine = createSVG('path', {
    d: occPath, fill: 'none', stroke: '#10b981',
    'stroke-width': 2, 'stroke-dasharray': '2,2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
  });
  svg.appendChild(occLine);
  const legend = [
    { color: '#d4af37', label: '房费收入(已结账)', dash: 'none' },
    { color: '#3b82f6', label: 'ADR(平均房价)', dash: '5,3' },
    { color: '#10b981', label: '今日入住率', dash: '2,2' }
  ];
  let lx = padding.left;
  legend.forEach(l => {
    const line = createSVG('line', {
      x1: lx, y1: 16, x2: lx + 20, y2: 16,
      stroke: l.color, 'stroke-width': 2.5
    });
    if (l.dash !== 'none') line.setAttribute('stroke-dasharray', l.dash);
    svg.appendChild(line);
    const t = createSVG('text', { x: lx + 26, y: 20, fill: '#475569', 'font-size': 12 });
    t.textContent = l.label;
    svg.appendChild(t);
    lx += 160;
  });
  const tooltip = document.createElement('div');
  tooltip.style.cssText = 'position:absolute;background:rgba(30,58,95,0.95);color:#fff;padding:10px 14px;border-radius:8px;font-size:12px;pointer-events:none;opacity:0;transition:opacity 0.2s;z-index:10;box-shadow:0 4px 16px rgba(0,0,0,0.2);line-height:1.7;';
  container.style.position = 'relative';
  container.appendChild(tooltip);
  container.appendChild(svg);
  svg.style.cursor = 'crosshair';
  data.forEach((d, i) => {
    const x = padding.left + xStep * i;
    const y = padding.top + chartH * (1 - d.revenue / revMax);
    const circle = createSVG('circle', {
      cx: x, cy: y, r: 5, fill: '#d4af37', stroke: '#fff', 'stroke-width': 2
    });
    circle.style.cursor = 'pointer';
    circle.addEventListener('mouseenter', () => {
      circle.setAttribute('r', 7);
      tooltip.innerHTML = `<strong>${d.date}</strong><br>已结账收入: ¥${d.revenue.toLocaleString()}<br>ADR: ¥${d.adr}<br>入住率: ${(d.occupancy * 100).toFixed(1)}%<br>在住: ${d.occupiedRooms}间<br>结账间夜: ${d.soldRooms}`;
      tooltip.style.left = `${x + 15}px`;
      tooltip.style.top = `${y - 40}px`;
      tooltip.style.opacity = 1;
    });
    circle.addEventListener('mouseleave', () => {
      circle.setAttribute('r', 5);
      tooltip.style.opacity = 0;
    });
    svg.appendChild(circle);
  });
}

function renderHeatmap(container, heatmap) {
  container.innerHTML = '';
  const typeOrder = [RoomTypes.SINGLE, RoomTypes.DOUBLE, RoomTypes.SUITE, RoomTypes.FAMILY];
  const wrapper = document.createElement('div');
  wrapper.className = 'heatmap-wrapper';
  const header = document.createElement('div');
  header.className = 'heatmap-header';
  header.innerHTML = '<div class="heatmap-corner">房型 \\ 日期</div>';
  const firstType = heatmap[typeOrder[0]];
  if (firstType) {
    firstType.forEach(d => {
      const cell = document.createElement('div');
      cell.className = 'heatmap-head-cell';
      const dateObj = new Date(d.date);
      const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
      cell.innerHTML = `<div>${d.date.slice(5)}</div><div class="hm-week">周${weekdays[dateObj.getDay()]}</div>`;
      header.appendChild(cell);
    });
  }
  wrapper.appendChild(header);
  typeOrder.forEach(type => {
    const row = document.createElement('div');
    row.className = 'heatmap-row';
    const label = document.createElement('div');
    label.className = 'heatmap-label';
    label.textContent = RoomTypeLabels[type];
    row.appendChild(label);
    const data = heatmap[type] || [];
    data.forEach(d => {
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      const intensity = Math.min(d.count / 10, 1);
      const r = Math.round(16 + (239 - 16) * intensity);
      const g = Math.round(185 + (68 - 185) * intensity);
      const b = Math.round(55 + (68 - 55) * intensity);
      cell.style.backgroundColor = `rgba(${r},${g},${b},${0.25 + intensity * 0.65})`;
      cell.style.color = intensity > 0.5 ? '#fff' : '#1e3a5f';
      const overTag = d.overbook > 0 ? `<span class="hm-over" title="其中超订${d.overbook}间">+${d.overbook}</span>` : '';
      cell.innerHTML = `<span class="hm-count">${d.count}</span><span class="hm-max">/10${overTag}</span>`;
      cell.title = `${RoomTypeLabels[type]} ${d.date}: 已预订 ${d.count} 间${d.overbook > 0 ? `（含超订 ${d.overbook} 间）` : ''}`;
      row.appendChild(cell);
    });
    wrapper.appendChild(row);
  });
  const legend = document.createElement('div');
  legend.className = 'heatmap-legend';
  legend.innerHTML = `
    <span>少</span>
    <div class="legend-gradient"></div>
    <span>多</span>
    <span style="margin-left:20px;display:inline-flex;align-items:center;gap:6px;"><span class="hm-over-dot"></span>含超订</span>
  `;
  container.appendChild(wrapper);
  container.appendChild(legend);
}

export { renderTrendChart, renderHeatmap };
