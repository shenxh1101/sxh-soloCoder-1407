import {
  RoomTypes,
  RoomTypeLabels,
  RoomStatus,
  getToday,
  setToday,
  addDays,
  getRooms,
  getPricing,
  savePricing,
  subscribe
} from './state.js';

import {
  getRoomStats,
  getOverbookingRisk,
  checkInRoom,
  checkOutRoom
} from './rooms.js';

import { getPriceInfo } from './pricing.js';
import { getTodayMetrics, getTrendData, getBookingHeatmap } from './revenue.js';
import { renderTrendChart, renderHeatmap } from './charts.js';
import {
  exportSnapshot,
  importSnapshot,
  importTeamCSV,
  generateSampleCSV
} from './io.js';

const ROUTE_TITLES = {
  dashboard: '房态总览',
  pricing: '动态定价设置',
  reports: '收益报告',
  data: '数据管理'
};

let toastTimer = null;

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = 'toast';
  }, 2600);
}

function openModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-backdrop').classList.add('active');
}

function closeModal() {
  document.getElementById('modal-backdrop').classList.remove('active');
}

function getRoute() {
  const hash = location.hash || '#/dashboard';
  return hash.replace('#/', '') || 'dashboard';
}

function navigate(route) {
  location.hash = `#/${route}`;
}

function renderRoute() {
  const route = getRoute();
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.route === route);
  });
  document.querySelectorAll('.page').forEach(el => {
    el.classList.toggle('hidden', el.id !== `page-${route}`);
  });
  document.getElementById('page-title').textContent = ROUTE_TITLES[route] || '房态总览';
  if (route === 'dashboard') renderDashboard();
  if (route === 'pricing') renderPricingPage();
  if (route === 'reports') renderReportsPage();
}

function renderDateControls() {
  const today = getToday();
  document.getElementById('today-picker').value = today;
  document.getElementById('sidebar-date').textContent = today;
}

function renderMetrics() {
  const m = getTodayMetrics();
  document.getElementById('m-revpar').textContent = `¥${m.revpar.toLocaleString()}`;
  document.getElementById('m-adr').textContent = `¥${m.adr.toLocaleString()}`;
  document.getElementById('m-occ').textContent = `${(m.occupancy * 100).toFixed(1)}%`;
  document.getElementById('m-occupied').textContent = `${m.occupiedRooms} / ${m.totalRooms}`;
}

function renderOverbookingAlert() {
  const risks = getOverbookingRisk();
  const atRisk = risks.filter(r => r.isAtRisk);
  const alert = document.getElementById('overbooking-alert');
  const text = document.getElementById('overbooking-text');
  if (atRisk.length > 0) {
    const names = atRisk.map(r => `${RoomTypeLabels[r.type]}(${r.used}/${r.total})`).join('、');
    text.textContent = `超订预警：${names} 已满房，新增预订将受限！`;
    alert.style.display = 'flex';
  } else {
    alert.style.display = 'none';
  }
}

function renderRoomGrid() {
  const container = document.getElementById('room-grid');
  container.innerHTML = '';
  const rooms = getRooms();
  const risks = getOverbookingRisk();
  const typeOrder = [RoomTypes.SINGLE, RoomTypes.DOUBLE, RoomTypes.SUITE, RoomTypes.FAMILY];
  typeOrder.forEach(type => {
    const section = document.createElement('div');
    section.className = 'room-type-section';
    const stats = getRoomStats()[type];
    const risk = risks.find(r => r.type === type);
    const header = document.createElement('div');
    header.className = 'room-type-header';
    header.innerHTML = `
      <div class="room-type-name">${RoomTypeLabels[type]}</div>
      <div class="room-type-stats">
        空闲 <strong>${stats.vacant}</strong> ·
        已住 <strong>${stats.occupied}</strong> ·
        预订 <strong>${stats.reserved}</strong> ·
        共 ${stats.total} 间
        ${risk && risk.isAtRisk ? '<span class="stat-risk"> · ⚠ 超订风险</span>' : ''}
      </div>
    `;
    section.appendChild(header);
    const grid = document.createElement('div');
    grid.className = 'room-grid';
    const typeRooms = rooms.filter(r => r.type === type).sort((a, b) => a.number - b.number);
    typeRooms.forEach(room => {
      const cell = document.createElement('div');
      const statusClass = room.status === RoomStatus.VACANT ? 'vacant'
        : room.status === RoomStatus.OCCUPIED ? 'occupied' : 'reserved';
      const riskClass = (risk && risk.isAtRisk && room.status === RoomStatus.VACANT) ? ' risk' : '';
      const statusText = room.status === RoomStatus.VACANT ? '空闲'
        : room.status === RoomStatus.OCCUPIED ? '在住' : '预订';
      cell.className = `room-cell ${statusClass}${riskClass}`;
      cell.innerHTML = `
        <span class="room-id">${room.id}</span>
        <span class="room-status-text">${statusText}</span>
      `;
      cell.addEventListener('click', () => handleRoomClick(room));
      grid.appendChild(cell);
    });
    section.appendChild(grid);
    container.appendChild(section);
  });
}

function handleRoomClick(room) {
  if (room.status === RoomStatus.VACANT) {
    openCheckInModal(room);
  } else {
    openCheckOutModal(room);
  }
}

function openCheckInModal(room) {
  const today = getToday();
  const html = `
    <div class="modal-header">
      <h3>办理入住 · ${room.id}</h3>
      <button class="btn-icon" onclick="window.__closeModal()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>客人姓名</label>
        <input type="text" class="input" id="f-guest" placeholder="请输入客人姓名" />
      </div>
      <div class="form-group">
        <label>入住日期</label>
        <input type="date" class="input" id="f-checkin" value="${today}" min="${today}" />
      </div>
      <div class="form-group">
        <label>入住天数</label>
        <input type="number" class="input" id="f-nights" value="1" min="1" max="30" />
      </div>
      <div class="price-preview" id="price-preview"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.__closeModal()">取消</button>
      <button class="btn btn-primary" id="btn-confirm-checkin">确认入住</button>
    </div>
  `;
  openModal(html);
  const updatePrice = () => {
    const nights = parseInt(document.getElementById('f-nights').value || '1', 10);
    const checkIn = document.getElementById('f-checkin').value || today;
    const info = getPriceInfo(room.type, checkIn, nights);
    const breakdown = info.dailyBreakdown.map(d =>
      `<div class="daily-breakdown-row"><span>${d.date}</span><span>¥${d.rate.toLocaleString()}</span></div>`
    ).join('');
    document.getElementById('price-preview').innerHTML = `
      <div class="price-row"><span class="label">房型</span><span class="value">${RoomTypeLabels[room.type]}</span></div>
      <div class="price-row"><span class="label">基础价 × ${nights}晚</span><span class="value">¥${info.baseTotal.toLocaleString()}</span></div>
      ${info.peakInfo.length > 0 ? `<div class="price-row"><span class="label">旺季加价</span><span class="value">${info.peakInfo.length}天涉及</span></div>` : ''}
      ${info.discount < 1 ? `<div class="price-row discount"><span class="label">提前预订折扣 (${(info.discount * 10).toFixed(1)}折)</span><span class="value">-¥${info.savings.toLocaleString()}</span></div>` : ''}
      <div class="daily-breakdown">${breakdown}</div>
      <div class="price-row total"><span class="label">订单总价</span><span class="value">¥${info.total.toLocaleString()}</span></div>
    `;
  };
  updatePrice();
  document.getElementById('f-nights').addEventListener('input', updatePrice);
  document.getElementById('f-checkin').addEventListener('change', updatePrice);
  document.getElementById('btn-confirm-checkin').addEventListener('click', () => {
    const guestName = document.getElementById('f-guest').value.trim();
    const checkInDate = document.getElementById('f-checkin').value;
    const nights = parseInt(document.getElementById('f-nights').value, 10);
    if (!guestName) { showToast('请输入客人姓名', 'error'); return; }
    if (!checkInDate) { showToast('请选择入住日期', 'error'); return; }
    if (!nights || nights < 1) { showToast('请输入有效入住天数', 'error'); return; }
    try {
      checkInRoom(room.id, { guestName, checkInDate, nights });
      showToast(`${guestName} 入住成功！`);
      closeModal();
      renderAll();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });
}

function openCheckOutModal(room) {
  const total = room.totalPrice || (room.dailyRate || 0) * (room.nights || 0);
  const html = `
    <div class="modal-header">
      <h3>退房 · ${room.id}</h3>
      <button class="btn-icon" onclick="window.__closeModal()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="modal-body">
      <div class="guest-info">
        <div class="guest-info-row"><span class="label">客人姓名</span><span class="value">${room.guestName || '-'}</span></div>
        <div class="guest-info-row"><span class="label">房型</span><span class="value">${RoomTypeLabels[room.type]}</span></div>
        <div class="guest-info-row"><span class="label">入住日期</span><span class="value">${room.checkInDate || '-'}</span></div>
        <div class="guest-info-row"><span class="label">退房日期</span><span class="value">${room.checkOutDate || '-'}</span></div>
        <div class="guest-info-row"><span class="label">入住天数</span><span class="value">${room.nights || 0} 晚</span></div>
        <div class="guest-info-row"><span class="label">日均房价</span><span class="value">¥${(room.dailyRate || 0).toLocaleString()}</span></div>
      </div>
      <div class="price-preview">
        <div class="price-row total"><span class="label">应收房费</span><span class="value">¥${total.toLocaleString()}</span></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.__closeModal()">取消</button>
      <button class="btn btn-primary" id="btn-confirm-checkout">确认退房并结账</button>
    </div>
  `;
  openModal(html);
  document.getElementById('btn-confirm-checkout').addEventListener('click', () => {
    try {
      const r = checkOutRoom(room.id);
      showToast(`${r.guestName} 已退房，房费 ¥${r.total.toLocaleString()}`);
      closeModal();
      renderAll();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });
}

function renderDashboard() {
  renderMetrics();
  renderOverbookingAlert();
  renderRoomGrid();
}

function renderPricingPage() {
  const pricing = getPricing();
  const baseForm = document.getElementById('base-price-form');
  baseForm.innerHTML = '';
  Object.entries(RoomTypeLabels).forEach(([type, label]) => {
    const wrap = document.createElement('div');
    wrap.className = 'input-wrapper';
    wrap.innerHTML = `
      <label>${label}</label>
      <span class="price-prefix">¥</span>
      <input type="number" class="input" data-type="${type}" min="0" step="1" value="${pricing.basePrices[type] || 0}" />
    `;
    baseForm.appendChild(wrap);
  });
  renderPeakList(pricing.peakSeasons);
  renderDiscountList(pricing.advanceDiscounts);
  document.getElementById('overbooking-threshold').value = (pricing.overbookingThreshold * 100).toFixed(1);
}

function renderPeakList(peaks) {
  const container = document.getElementById('peak-list');
  if (!peaks || peaks.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无旺季规则，点击右上角「添加上旺季」创建</div>';
    return;
  }
  container.innerHTML = '';
  peaks.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'peak-item';
    row.innerHTML = `
      <input type="text" class="input" placeholder="规则名称" data-idx="${idx}" data-field="name" value="${p.name || ''}" style="max-width:160px;" />
      <input type="date" class="input" data-idx="${idx}" data-field="startDate" value="${p.startDate || ''}" />
      <span style="color:var(--text-muted)">至</span>
      <input type="date" class="input" data-idx="${idx}" data-field="endDate" value="${p.endDate || ''}" />
      <input type="number" class="input" data-idx="${idx}" data-field="multiplier" step="0.05" min="1" max="3" value="${p.multiplier || 1.3}" style="max-width:100px;" />
      <span style="color:var(--text-muted);font-size:12px;">倍</span>
      <button class="btn-icon" data-peak-del="${idx}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    `;
    container.appendChild(row);
  });
  container.querySelectorAll('[data-peak-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.peakDel, 10);
      const p = getPricing();
      p.peakSeasons.splice(idx, 1);
      savePricing(p);
      renderPeakList(p.peakSeasons);
    });
  });
}

function renderDiscountList(discounts) {
  const container = document.getElementById('discount-list');
  if (!discounts || discounts.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无提前预订折扣规则</div>';
    return;
  }
  container.innerHTML = '';
  discounts.forEach((d, idx) => {
    const row = document.createElement('div');
    row.className = 'discount-item';
    row.innerHTML = `
      <span style="font-size:13px;color:var(--text-secondary);min-width:100px;">提前</span>
      <input type="number" class="input" data-idx="${idx}" data-field="daysAhead" min="1" max="180" value="${d.daysAhead || 0}" style="max-width:100px;" />
      <span style="color:var(--text-muted);font-size:12px;">天及以上预订，享受</span>
      <input type="number" class="input" data-idx="${idx}" data-field="discountRate" step="0.05" min="0.1" max="1" value="${d.discountRate || 1}" style="max-width:100px;" />
      <span style="color:var(--text-muted);font-size:12px;">折率 （${((d.discountRate || 1) * 10).toFixed(1)}折）</span>
      <button class="btn-icon" data-disc-del="${idx}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    `;
    container.appendChild(row);
  });
  container.querySelectorAll('[data-disc-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.discDel, 10);
      const p = getPricing();
      p.advanceDiscounts.splice(idx, 1);
      savePricing(p);
      renderDiscountList(p.advanceDiscounts);
    });
  });
}

function savePricingFromForm() {
  const pricing = getPricing();
  document.querySelectorAll('#base-price-form input[data-type]').forEach(el => {
    pricing.basePrices[el.dataset.type] = parseFloat(el.value) || 0;
  });
  document.querySelectorAll('#peak-list input').forEach(el => {
    const idx = parseInt(el.dataset.idx, 10);
    const field = el.dataset.field;
    if (pricing.peakSeasons[idx]) {
      if (field === 'multiplier') {
        pricing.peakSeasons[idx][field] = parseFloat(el.value) || 1;
      } else {
        pricing.peakSeasons[idx][field] = el.value;
      }
    }
  });
  document.querySelectorAll('#discount-list input').forEach(el => {
    const idx = parseInt(el.dataset.idx, 10);
    const field = el.dataset.field;
    if (pricing.advanceDiscounts[idx]) {
      pricing.advanceDiscounts[idx][field] = parseFloat(el.value) || 0;
    }
  });
  pricing.overbookingThreshold = parseFloat(document.getElementById('overbooking-threshold').value) / 100 || 0.05;
  savePricing(pricing);
  showToast('定价设置已保存');
  renderAll();
}

function renderReportsPage() {
  renderTrendChart(document.getElementById('trend-chart'), getTrendData(30));
  renderHeatmap(document.getElementById('heatmap-chart'), getBookingHeatmap(7));
}

function renderAll() {
  renderDateControls();
  renderRoute();
}

function bindEvents() {
  window.__closeModal = closeModal;
  document.getElementById('modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });
  document.getElementById('today-picker').addEventListener('change', (e) => {
    setToday(e.target.value);
    renderAll();
  });
  document.getElementById('btn-prev-day').addEventListener('click', () => {
    setToday(addDays(getToday(), -1));
    renderAll();
  });
  document.getElementById('btn-next-day').addEventListener('click', () => {
    setToday(addDays(getToday(), 1));
    renderAll();
  });
  document.getElementById('btn-add-peak').addEventListener('click', () => {
    const p = getPricing();
    const today = getToday();
    p.peakSeasons.push({
      id: `peak_${Date.now()}`,
      name: `旺季${p.peakSeasons.length + 1}`,
      startDate: today,
      endDate: addDays(today, 7),
      multiplier: 1.3
    });
    savePricing(p);
    renderPeakList(p.peakSeasons);
  });
  document.getElementById('btn-save-pricing').addEventListener('click', savePricingFromForm);
  document.getElementById('btn-export-snapshot').addEventListener('click', () => {
    exportSnapshot();
    showToast('快照已导出');
  });
  document.getElementById('import-snapshot').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await importSnapshot(file);
      showToast('快照已恢复');
      renderAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
    e.target.value = '';
  });
  document.getElementById('import-csv').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const resultEl = document.getElementById('import-result');
    if (!file) return;
    try {
      const results = await importTeamCSV(file);
      resultEl.className = 'import-result success';
      resultEl.textContent = `成功导入 ${results.length} 条团队预订记录`;
      showToast(`团队预订导入成功（${results.length}间）`);
      renderAll();
    } catch (err) {
      resultEl.className = 'import-result error';
      resultEl.textContent = err.message;
      showToast('导入失败', 'error');
    }
    e.target.value = '';
  });
  document.getElementById('btn-sample-csv').addEventListener('click', () => {
    generateSampleCSV();
    showToast('CSV模板已下载');
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm('确定要重置所有数据吗？此操作不可撤销！')) {
      localStorage.clear();
      showToast('数据已重置，请刷新页面');
      setTimeout(() => location.reload(), 1000);
    }
  });
  window.addEventListener('hashchange', renderRoute);
  subscribe(renderAll);
}

export {
  renderAll,
  bindEvents,
  showToast,
  closeModal,
  openModal
};
