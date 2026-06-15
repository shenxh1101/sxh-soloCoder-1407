import {
  RoomTypes,
  RoomTypeLabels,
  getToday,
  setToday,
  addDays,
  formatDate,
  getRooms,
  getPricing,
  savePricing,
  subscribe,
  BookingStatus,
  PriceSource,
  TeamStatus,
  getTeams,
  createTeam,
  updateTeam
} from './state.js';

import {
  getRoomStats,
  getOverbookingRisk,
  checkInRoom,
  checkOutBooking,
  getRoomDateStatus,
  getActiveBookingsForRoom,
  hasConflict,
  reserveRoom,
  canAcceptBooking,
  willBeOverbook,
  countBookingsOnDate,
  bulkBook,
  bulkBookTransactional,
  findAvailableRoom,
  cancelBooking,
  extendBooking,
  changeRoom,
  getArrivalList,
  getInHouseList,
  getDepartureList,
  getRevenueLedger,
  allocateTeam,
  rescheduleTeam,
  cancelTeamBooking,
  cancelAllTeamBookings,
  getTeamBookings
} from './rooms.js';

import { getPriceInfo } from './pricing.js';
import { getTodayMetrics, getTrendData, getBookingHeatmap, getRevenueBreakdown } from './revenue.js';
import { renderTrendChart, renderHeatmap } from './charts.js';
import {
  exportSnapshot,
  importSnapshot,
  importTeamCSV,
  generateSampleCSV
} from './io.js';

const ROUTE_TITLES = {
  dashboard: '房态总览',
  frontdesk: '到店执行台',
  teams: '团队管理',
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
  if (route === 'frontdesk') renderFrontdeskPage();
  if (route === 'teams') renderTeamsPage();
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
  const atRisk = risks.filter(r => r.totalUsed > r.total || r.overbookUsed > 0);
  const alert = document.getElementById('overbooking-alert');
  const text = document.getElementById('overbooking-text');
  if (atRisk.length > 0) {
    const names = atRisk.map(r => {
      const tag = r.overbookUsed > 0 ? `超订${r.overbookUsed}间` : '已满房';
      return `${RoomTypeLabels[r.type]}(${r.totalUsed}/${r.allowed}，${tag})`;
    }).join('、');
    text.textContent = `超订预警：${names}，请注意管控风险！`;
    alert.style.display = 'flex';
  } else {
    alert.style.display = 'none';
  }
}

function getRoomCellDisplay(room) {
  const today = getToday();
  const s = getRoomDateStatus(room, today);
  if (s.status === 'vacant') {
    const upcoming = getActiveBookingsForRoom(room);
    if (upcoming.length > 0) {
      return {
        class: 'reserved-future',
        text: `待入住(${upcoming.length})`,
        title: `今日空闲，已有 ${upcoming.length} 笔未来预订`,
        hasBooking: true,
        booking: null,
        isOverbook: false
      };
    }
    return {
      class: 'vacant',
      text: '空闲',
      title: '今日空闲，可立即入住',
      hasBooking: false,
      booking: null,
      isOverbook: false
    };
  }
  const tag = s.status === 'checked_in' ? '在住' : '预订';
  const overTag = s.isOverbook ? ' ⚠' : '';
  return {
    class: s.status + (s.isOverbook ? ' overbook' : ''),
    text: `${tag}${overTag}`,
    title: `${s.booking.guestName} · ${s.booking.checkInDate} 至 ${s.booking.checkOutDate} (${s.booking.nights}晚) · 房价 ¥${s.booking.dailyRate}/晚${s.isOverbook ? ' · 超订' : ''}`,
    hasBooking: true,
    booking: s.booking,
    isOverbook: s.isOverbook
  };
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
        在住 <strong>${stats.occupied}</strong> ·
        预订 <strong>${stats.reserved}</strong>
        ${stats.overbook > 0 ? ` · 超订 <strong class="stat-risk">${stats.overbook}</strong>` : ''}
         · 共 ${stats.total} 间
        ${risk && risk.totalUsed > risk.total ? '<span class="stat-risk"> · ⚠ 超订中</span>' : ''}
      </div>
    `;
    section.appendChild(header);
    const grid = document.createElement('div');
    grid.className = 'room-grid';
    const typeRooms = rooms.filter(r => r.type === type).sort((a, b) => a.number - b.number);
    typeRooms.forEach(room => {
      const display = getRoomCellDisplay(room);
      const cell = document.createElement('div');
      cell.className = `room-cell ${display.class}`;
      cell.title = display.title;
      cell.innerHTML = `
        <span class="room-id">${room.id}</span>
        <span class="room-status-text">${display.text}</span>
      `;
      cell.addEventListener('click', () => handleRoomClick(room));
      grid.appendChild(cell);
    });
    section.appendChild(grid);
    container.appendChild(section);
  });
}

function handleRoomClick(room) {
  const today = getToday();
  const todayStatus = getRoomDateStatus(room, today);
  const allBookings = getActiveBookingsForRoom(room);
  if (todayStatus.status === 'vacant' && allBookings.length === 0) {
    openCheckInModal(room);
  } else {
    openRoomDetailModal(room, todayStatus, allBookings);
  }
}

function openRoomDetailModal(room, todayStatus, allBookings) {
  const bookingCards = allBookings
    .sort((a, b) => a.checkInDate.localeCompare(b.checkInDate))
    .map(b => {
      const isCheckedIn = b.status === BookingStatus.CHECKED_IN;
      const isToday = getToday() >= b.checkInDate && getToday() < b.checkOutDate;
      const overTag = b.isOverbook ? '<span class="tag tag-over">超订</span>' : '';
      const statusTag = isCheckedIn ? '<span class="tag tag-in">在住</span>' : '<span class="tag tag-res">预订</span>';
      const todayTag = isToday ? '<span class="tag tag-today">今日</span>' : '';
      return `
        <div class="booking-card ${isCheckedIn ? 'card-in' : 'card-res'}">
          <div class="booking-head">
            <strong>${b.guestName}</strong>
            <div>${overTag} ${statusTag} ${todayTag}</div>
          </div>
          <div class="booking-body">
            <div><span>入住</span>${b.checkInDate}</div>
            <div><span>退房</span>${b.checkOutDate}</div>
            <div><span>间夜</span>${b.nights}晚</div>
            <div><span>房价</span>¥${b.dailyRate.toLocaleString()}/晚</div>
            <div><span>总价</span>¥${b.totalPrice.toLocaleString()}</div>
          </div>
          <div class="booking-foot">
            <button class="btn btn-primary btn-sm" data-checkout="${b.id}">
              ${isCheckedIn ? '退房结账' : '取消预订'}
            </button>
          </div>
        </div>
      `;
    }).join('');
  const html = `
    <div class="modal-header">
      <h3>房间详情 · ${room.id}</h3>
      <button class="btn-icon" onclick="window.__closeModal()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="modal-body">
      <div class="room-detail-info">
        <div>房型：<strong>${RoomTypeLabels[room.type]}</strong></div>
        <div>今日状态：<strong>${todayStatus.status === 'vacant' ? '空闲' : todayStatus.status === 'checked_in' ? '客人在住' : '已预订未入住'}</strong></div>
      </div>
      <div class="section-title">有效预订（${allBookings.length}）</div>
      <div class="bookings-list">
        ${bookingCards || '<div class="empty-state">当前暂无有效预订</div>'}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.__closeModal()">关闭</button>
      <button class="btn btn-primary" id="btn-add-booking">新增预订</button>
    </div>
  `;
  openModal(html);
  document.querySelectorAll('[data-checkout]').forEach(btn => {
    btn.addEventListener('click', () => {
      const bid = btn.dataset.checkout;
      const booking = allBookings.find(b => b.id === bid);
      if (!booking) return;
      if (booking.status === BookingStatus.CHECKED_IN) {
        if (!confirm(`确认 ${booking.guestName} 退房结账？`)) return;
        try {
          const r = checkOutBooking(room.id, bid);
          showToast(`${r.guestName} 已退房，房费 ¥${r.total.toLocaleString()}`);
          closeModal();
          renderAll();
        } catch (e) {
          showToast(e.message, 'error');
        }
      } else {
        if (!confirm(`确认取消 ${booking.guestName} 的预订？\n该操作将释放占用的房间库存，不计入今日结账。`)) return;
        try {
          const r = cancelBooking(room.id, bid, '房间详情撤单');
          showToast(`预订已取消`);
          closeModal();
          renderAll();
        } catch (e) {
          showToast(e.message, 'error');
        }
      }
    });
  });
  document.getElementById('btn-add-booking').addEventListener('click', () => {
    openCheckInModal(room);
  });
}

function openCheckInModal(room) {
  const today = getToday();
  const html = `
    <div class="modal-header">
      <h3>办理入住/预订 · ${room.id}</h3>
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
      <div class="form-group">
        <label>实际成交房价（元/晚，可选）</label>
        <input type="number" class="input" id="f-manual-rate" min="0" step="1" placeholder="留空则按动态定价自动计算" />
        <div class="hint" style="font-size:11px;color:var(--text-muted);margin-top:4px;">手动填写后，系统将以此价格作为最终成交价，不再应用旺季/提前折扣</div>
      </div>
      <div class="price-preview" id="price-preview"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="window.__closeModal()">取消</button>
      <button class="btn btn-primary" id="btn-confirm-checkin">确认办理</button>
    </div>
  `;
  openModal(html);
  const updatePrice = () => {
    const nights = parseInt(document.getElementById('f-nights').value || '1', 10);
    const checkIn = document.getElementById('f-checkin').value || today;
    const manualRaw = document.getElementById('f-manual-rate').value;
    const manualRate = manualRaw ? parseFloat(manualRaw) : null;
    const hasConflictHere = hasConflict(room, checkIn, addDays(checkIn, nights));
    if (hasConflictHere) {
      document.getElementById('price-preview').innerHTML = `
        <div style="color:var(--danger);font-weight:600;text-align:center;padding:8px 0;">
          ⚠ 该房间在 ${checkIn} 至 ${addDays(checkIn, nights)} 已有预订，存在日期冲突
        </div>
      `;
      return;
    }
    if (manualRate && manualRate > 0) {
      const total = Math.round(manualRate) * nights;
      document.getElementById('price-preview').innerHTML = `
        <div class="price-row"><span class="label">房型</span><span class="value">${RoomTypeLabels[room.type]}</span></div>
        <div class="price-row"><span class="label">手动房价</span><span class="value">¥${Math.round(manualRate).toLocaleString()} / 晚</span></div>
        <div class="price-row"><span class="label">入住天数</span><span class="value">${nights} 晚</span></div>
        <div class="price-row total"><span class="label">订单总价</span><span class="value">¥${total.toLocaleString()}</span></div>
      `;
    } else {
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
        <div class="price-row total"><span class="label">订单总价（动态定价）</span><span class="value">¥${info.total.toLocaleString()}</span></div>
      `;
    }
  };
  updatePrice();
  document.getElementById('f-nights').addEventListener('input', updatePrice);
  document.getElementById('f-checkin').addEventListener('change', updatePrice);
  document.getElementById('f-manual-rate').addEventListener('input', updatePrice);
  document.getElementById('btn-confirm-checkin').addEventListener('click', () => {
    const guestName = document.getElementById('f-guest').value.trim();
    const checkInDate = document.getElementById('f-checkin').value;
    const nights = parseInt(document.getElementById('f-nights').value, 10);
    const manualRaw = document.getElementById('f-manual-rate').value;
    const manualRate = manualRaw ? parseFloat(manualRaw) : null;
    if (!guestName) { showToast('请输入客人姓名', 'error'); return; }
    if (!checkInDate) { showToast('请选择入住日期', 'error'); return; }
    if (!nights || nights < 1) { showToast('请输入有效入住天数', 'error'); return; }
    try {
      const opts = { guestName, checkInDate, nights };
      if (manualRate && manualRate > 0) opts.manualRate = manualRate;
      const result = checkInRoom(room.id, opts);
      const tag = result.booking.isOverbook ? '（超订）' : '';
      showToast(`${guestName} 预订成功${tag}！${checkInDate} 入住 ${nights} 晚，总价 ¥${result.booking.totalPrice.toLocaleString()}`);
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

function renderFrontdeskPage() {
  const today = getToday();
  const tomorrow = addDays(today, 1);

  const arrivals = getArrivalList();
  const inHouse = getInHouseList();
  const departures = getDepartureList();

  document.getElementById('fd-date-today').textContent = formatDate(today);
  document.getElementById('fd-date-tomorrow').textContent = formatDate(tomorrow);
  document.getElementById('fd-arrival-count').textContent = arrivals.length;
  document.getElementById('fd-inhouse-count').textContent = inHouse.length;
  document.getElementById('fd-departure-count').textContent = departures.length;

  renderBookingList('fd-arrival-list', arrivals, 'arrival');
  renderBookingList('fd-inhouse-list', inHouse, 'inhouse');
  renderBookingList('fd-departure-list', departures, 'departure');
}

function renderBookingList(containerId, bookings, type) {
  const container = document.getElementById(containerId);
  if (!bookings || bookings.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无记录</div>';
    return;
  }

  container.innerHTML = bookings.map(b => {
    const typeLabel = RoomTypeLabels[b.roomType] || b.roomType;
    const priceTag = b.priceSource === PriceSource.MANUAL
      ? `<span class="tag tag-manual">手动价 ¥${b.dailyRate}</span>`
      : `<span class="tag tag-dynamic">动态价 ¥${b.dailyRate}</span>`;
    const teamTag = b.teamName ? `<span class="tag tag-team">${b.teamName}</span>` : '';
    const overbookTag = b.isOverbook ? `<span class="tag tag-overbook">超订</span>` : '';

    let actions = '';
    if (type === 'arrival') {
      actions = `
        <button class="btn btn-primary btn-sm" data-action="checkin" data-booking="${b.id}" data-room="${b.roomId}">办入住</button>
        <button class="btn btn-outline btn-sm" data-action="cancel" data-booking="${b.id}" data-room="${b.roomId}">取消</button>
      `;
    } else if (type === 'inhouse') {
      actions = `
        <button class="btn btn-primary btn-sm" data-action="checkout" data-booking="${b.id}" data-room="${b.roomId}">结账</button>
        <button class="btn btn-outline btn-sm" data-action="extend" data-booking="${b.id}" data-room="${b.roomId}">延住</button>
        <button class="btn btn-outline btn-sm" data-action="change" data-booking="${b.id}" data-room="${b.roomId}" data-type="${b.roomType}">换房</button>
      `;
    } else if (type === 'departure') {
      actions = `
        <button class="btn btn-primary btn-sm" data-action="checkout" data-booking="${b.id}" data-room="${b.roomId}">提前结账</button>
        <button class="btn btn-outline btn-sm" data-action="extend" data-booking="${b.id}" data-room="${b.roomId}">续住</button>
      `;
    }

    return `
      <div class="booking-card">
        <div class="booking-card-header">
          <span class="booking-room">${b.roomNumber}房 · ${typeLabel}</span>
          ${overbookTag}
        </div>
        <div class="booking-card-body">
          <div class="booking-info">
            <span class="booking-guest">${b.guestName || '待登记'}</span>
            ${teamTag}
          </div>
          <div class="booking-dates">
            ${formatDate(b.checkInDate)} → ${formatDate(b.checkOutDate)}
            <span class="booking-nights">${b.nights}晚</span>
          </div>
          <div class="booking-price-row">
            ${priceTag}
            <span class="booking-total">总计 ¥${b.totalPrice}</span>
          </div>
        </div>
        <div class="booking-card-actions">
          ${actions}
        </div>
      </div>
    `;
  }).join('');
}

function handleFrontdeskAction(action, bookingId, roomId, extra = {}) {
  switch (action) {
    case 'checkin':
      openCheckinModal(roomId, bookingId);
      break;
    case 'checkout':
      if (confirm('确认办理结账？')) {
        const result = checkOutBooking(roomId, bookingId);
        if (result.ok) {
          showToast(`结账成功，房费 ¥${result.revenue}`);
          renderAll();
        } else {
          showToast(result.error, 'error');
        }
      }
      break;
    case 'cancel':
      if (confirm('确认取消该预订？未到店预订不影响当日收益。')) {
        const result = cancelBooking(roomId, bookingId, '前台取消');
        if (result.ok) {
          showToast('预订已取消');
          renderAll();
        } else {
          showToast(result.error, 'error');
        }
      }
      break;
    case 'extend':
      openExtendModal(roomId, bookingId);
      break;
    case 'change':
      openChangeRoomModal(roomId, bookingId, extra.roomType);
      break;
  }
}

function openCheckinModal(roomId, bookingId) {
  const rooms = getRooms();
  const room = rooms.find(r => r.id === roomId);
  const booking = (room?.bookings || []).find(b => b.id === bookingId);
  if (!booking) return;

  const html = `
    <div class="modal-body">
      <h3 class="modal-title">办理入住 - ${room.id}</h3>
      <div class="form-group">
        <label>客人姓名</label>
        <input type="text" id="ci-guest" class="input" value="${booking.guestName || ''}" placeholder="请输入客人姓名" />
      </div>
      <div class="form-group">
        <label>入住日期</label>
        <input type="date" id="ci-checkin" class="input" value="${booking.checkInDate}" readonly />
      </div>
      <div class="form-group">
        <label>离店日期</label>
        <input type="date" id="ci-checkout" class="input" value="${booking.checkOutDate}" readonly />
      </div>
      <div class="form-group">
        <label>房价模式</label>
        <div class="price-mode-switch">
          <label class="radio-label">
            <input type="radio" name="ci-price-mode" value="dynamic" ${booking.priceSource !== PriceSource.MANUAL ? 'checked' : ''} />
            动态定价 (¥${booking.dailyRate}/晚)
          </label>
          <label class="radio-label">
            <input type="radio" name="ci-price-mode" value="manual" ${booking.priceSource === PriceSource.MANUAL ? 'checked' : ''} />
            手动房价
          </label>
        </div>
      </div>
      <div class="form-group" id="ci-manual-rate-group" style="${booking.priceSource !== PriceSource.MANUAL ? 'display:none;' : ''}">
        <label>手动房价 (元/晚)</label>
        <input type="number" id="ci-manual-rate" class="input" min="0" step="1" value="${booking.priceSource === PriceSource.MANUAL ? booking.dailyRate : ''}" placeholder="请输入手动房价" />
      </div>
      <div class="price-banner" id="ci-price-banner">
        总计：¥<span id="ci-total">${booking.totalPrice}</span>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="window.__closeModal()">取消</button>
        <button class="btn btn-primary" id="btn-confirm-checkin">确认入住</button>
      </div>
    </div>
  `;
  openModal(html);

  document.querySelectorAll('input[name="ci-price-mode"]').forEach(el => {
    el.addEventListener('change', (e) => {
      const isManual = e.target.value === 'manual';
      document.getElementById('ci-manual-rate-group').style.display = isManual ? 'block' : 'none';
      if (!isManual) {
        document.getElementById('ci-total').textContent = booking.totalPrice;
      }
    });
  });

  document.getElementById('ci-manual-rate').addEventListener('input', (e) => {
    const rate = parseFloat(e.target.value) || 0;
    const nights = booking.nights;
    document.getElementById('ci-total').textContent = (rate * nights).toFixed(0);
  });

  document.getElementById('btn-confirm-checkin').addEventListener('click', () => {
    const guestName = document.getElementById('ci-guest').value.trim();
    const mode = document.querySelector('input[name="ci-price-mode"]:checked').value;
    const manualRate = mode === 'manual' ? parseFloat(document.getElementById('ci-manual-rate').value) : null;

    if (!guestName) {
      showToast('请输入客人姓名', 'error');
      return;
    }
    if (mode === 'manual' && (!manualRate || manualRate <= 0)) {
      showToast('请输入有效的手动房价', 'error');
      return;
    }

    const result = checkInRoom(roomId, { guestName, bookingId, manualRate });
    if (result.ok) {
      showToast(`${room.id} 入住成功`);
      closeModal();
      renderAll();
    } else {
      showToast(result.error, 'error');
    }
  });
}

function openExtendModal(roomId, bookingId) {
  const rooms = getRooms();
  const room = rooms.find(r => r.id === roomId);
  const booking = (room?.bookings || []).find(b => b.id === bookingId);
  if (!booking) return;

  const html = `
    <div class="modal-body">
      <h3 class="modal-title">延住 - ${room.id}</h3>
      <div class="form-group">
        <label>当前离店日期</label>
        <input type="date" class="input" value="${booking.checkOutDate}" readonly />
      </div>
      <div class="form-group">
        <label>延住天数</label>
        <input type="number" id="ext-nights" class="input" min="1" max="30" value="1" />
      </div>
      <div class="price-banner">
        预计增加费用：¥<span id="ext-total">--</span>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="window.__closeModal()">取消</button>
        <button class="btn btn-primary" id="btn-confirm-extend">确认延住</button>
      </div>
    </div>
  `;
  openModal(html);

  const updateExtPrice = () => {
    const nights = parseInt(document.getElementById('ext-nights').value, 10) || 0;
    if (nights > 0) {
      document.getElementById('ext-total').textContent = (booking.dailyRate * nights).toFixed(0);
    }
  };
  updateExtPrice();
  document.getElementById('ext-nights').addEventListener('input', updateExtPrice);

  document.getElementById('btn-confirm-extend').addEventListener('click', () => {
    const nights = parseInt(document.getElementById('ext-nights').value, 10);
    if (!nights || nights < 1) {
      showToast('请输入有效的延住天数', 'error');
      return;
    }
    const result = extendBooking(roomId, bookingId, nights);
    if (result.ok) {
      showToast(`延住成功，新增 ${nights} 晚`);
      closeModal();
      renderAll();
    } else {
      showToast(result.error, 'error');
    }
  });
}

function openChangeRoomModal(fromRoomId, bookingId, roomType) {
  const rooms = getRooms();
  const fromRoom = rooms.find(r => r.id === fromRoomId);
  const booking = (fromRoom?.bookings || []).find(b => b.id === bookingId);
  if (!booking) return;

  const sameTypeRooms = rooms.filter(r => r.type === roomType && r.id !== fromRoomId);
  const availableRooms = sameTypeRooms.filter(r => {
    return !hasConflict(r, booking.checkInDate, booking.checkOutDate, bookingId);
  });

  const html = `
    <div class="modal-body">
      <h3 class="modal-title">换房 - 从${fromRoom.id}</h3>
      <div class="form-group">
        <label>选择目标房间（${RoomTypeLabels[roomType]}）</label>
        <div class="room-select-list">
          ${availableRooms.length === 0
            ? '<div class="empty-state">暂无可用房间</div>'
            : availableRooms.map(r => `
              <label class="room-select-item">
                <input type="radio" name="change-to" value="${r.id}" />
                <span class="room-select-number">${r.id}</span>
                <span class="room-select-status">空闲可换</span>
              </label>
            `).join('')
          }
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="window.__closeModal()">取消</button>
        <button class="btn btn-primary" id="btn-confirm-change" ${availableRooms.length === 0 ? 'disabled' : ''}>确认换房</button>
      </div>
    </div>
  `;
  openModal(html);

  document.getElementById('btn-confirm-change').addEventListener('click', () => {
    const selected = document.querySelector('input[name="change-to"]:checked');
    if (!selected) {
      showToast('请选择目标房间', 'error');
      return;
    }
    const result = changeRoom(bookingId, fromRoomId, selected.value);
    if (result.ok) {
      showToast('换房成功');
      closeModal();
      renderAll();
    } else {
      showToast(result.error, 'error');
    }
  });
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
      pricing.peakSeasons[idx][field] = field === 'multiplier' ? (parseFloat(el.value) || 1) : el.value;
    }
  });
  document.querySelectorAll('#discount-list input').forEach(el => {
    const idx = parseInt(el.dataset.idx, 10);
    const field = el.dataset.field;
    if (pricing.advanceDiscounts[idx]) {
      pricing.advanceDiscounts[idx][field] = parseFloat(el.value) || 0;
    }
  });
  pricing.overbookingThreshold = (parseFloat(document.getElementById('overbooking-threshold').value) || 5) / 100;
  savePricing(pricing);
  showToast('定价设置已保存');
  renderAll();
}

function renderTeamsPage() {
  const teams = getTeams();
  const container = document.getElementById('team-list');
  const statsEl = document.getElementById('team-stats');

  const pendingCount = teams.filter(t => t.status === TeamStatus.PENDING).length;
  const activeCount = teams.filter(t => t.status === TeamStatus.ALLOCATED || t.status === TeamStatus.PARTIAL).length;

  let totalRoomNights = 0;
  let totalRevenueAll = 0;
  const pricing = getPricing();
  teams.forEach(t => {
    const bookings = getTeamBookings(t.id).filter(b => b.status !== BookingStatus.CANCELLED);
    const cancelledBookings = getTeamBookings(t.id).filter(b => b.status === BookingStatus.CANCELLED);
    t._bookings = bookings;
    t._cancelledBookings = cancelledBookings;
    t._roomNights = bookings.reduce((s, b) => s + (b.nights || 0), 0);
    t._revenue = bookings.reduce((s, b) => s + (b.totalPrice || 0), 0);
    t._cancelledRevenue = cancelledBookings.reduce((s, b) => s + (b.totalPrice || 0), 0);
    if (t.status === TeamStatus.PENDING) {
      const perNight = t.manualRate || (pricing.basePrices[t.roomType] || 0);
      t._pendingRoomNights = t.count * t.nights;
      t._pendingRevenue = perNight * t.count * t.nights;
    } else {
      t._pendingRoomNights = 0;
      t._pendingRevenue = 0;
    }
    totalRoomNights += t._roomNights + t._pendingRoomNights;
    totalRevenueAll += t._revenue + t._pendingRevenue;
  });

  statsEl.innerHTML = `
    <div class="stat-item">
      <div class="stat-value">${teams.length}</div>
      <div class="stat-label">团队总数</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${pendingCount}</div>
      <div class="stat-label">待分房</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${activeCount}</div>
      <div class="stat-label">进行中</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${totalRoomNights}</div>
      <div class="stat-label">总房间夜</div>
    </div>
  `;

  if (teams.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无团队记录，从数据管理页导入团队预订</div>';
    return;
  }

  container.innerHTML = teams.map(t => {
    const statusMap = {
      [TeamStatus.PENDING]: { label: '待分房', cls: 'tag-warning' },
      [TeamStatus.ALLOCATED]: { label: '已分房', cls: 'tag-success' },
      [TeamStatus.PARTIAL]: { label: '部分取消', cls: 'tag-warning' },
      [TeamStatus.CANCELLED]: { label: '已取消', cls: 'tag-danger' }
    };
    const status = statusMap[t.status] || { label: t.status, cls: '' };

    const roomsByType = {};
    (t._bookings || []).forEach(b => {
      if (!roomsByType[b.roomType]) roomsByType[b.roomType] = { count: 0, nights: 0, revenue: 0 };
      roomsByType[b.roomType].count++;
      roomsByType[b.roomType].nights += b.nights;
      roomsByType[b.roomType].revenue += b.totalPrice;
    });

    let typeSummary;
    if (t.status === TeamStatus.PENDING) {
      const nights = t.nights;
      typeSummary = `${RoomTypeLabels[t.roomType] || t.roomType} ${t.count}间×${nights}晚 (待分房)`;
    } else {
      const typeParts = Object.entries(roomsByType).map(([type, info]) =>
        `${RoomTypeLabels[type] || type} ${info.count}间×${info.nights}晚`
      );
      if ((t.cancelledCount || 0) > 0) {
        typeParts.push(`已取消 ${t.cancelledCount}间`);
      }
      typeSummary = typeParts.join('，') || '暂无房型信息';
    }

    const totalRevenue = t.status === TeamStatus.PENDING ? (t._pendingRevenue || 0) : (t._revenue || 0);
    const priceTag = t.manualRate
      ? `<span class="tag tag-manual">团价 ¥${t.manualRate}</span>`
      : `<span class="tag tag-dynamic">动态价</span>`;
    const pendingTag = t.status === TeamStatus.PENDING ? `<span class="tag tag-warning">预估</span>` : '';

    let actions = '';
    if (t.status === TeamStatus.PENDING) {
      actions = `
        <button class="btn btn-primary btn-sm" data-action="allocate" data-team="${t.id}">一键分房</button>
        <button class="btn btn-outline btn-sm" data-action="reschedule" data-team="${t.id}">改期</button>
        <button class="btn btn-outline btn-sm btn-danger" data-action="cancel-team" data-team="${t.id}">取消团队</button>
      `;
    } else if (t.status === TeamStatus.ALLOCATED || t.status === TeamStatus.PARTIAL) {
      actions = `
        <button class="btn btn-outline btn-sm" data-action="view" data-team="${t.id}">查看房间</button>
        <button class="btn btn-outline btn-sm" data-action="reschedule" data-team="${t.id}">改期</button>
        <button class="btn btn-outline btn-sm btn-danger" data-action="cancel-team" data-team="${t.id}">取消未入住</button>
      `;
    }

    const checkOutDate = t.checkOutDate || addDays(t.checkInDate, t.nights);

    return `
      <div class="team-card">
        <div class="team-card-header">
          <div class="team-name">${t.name}</div>
          <span class="tag ${status.cls}">${status.label}</span>
        </div>
        <div class="team-card-body">
          <div class="team-info-row">
            <span>入住：${formatDate(t.checkInDate)}</span>
            <span>离店：${formatDate(checkOutDate)}</span>
            <span>${t.nights}晚</span>
          </div>
          <div class="team-info-row">
            <span class="text-muted">${typeSummary}</span>
          </div>
          <div class="team-info-row">
            <span class="text-muted">总房费：¥${totalRevenue.toLocaleString()}</span>
            ${pendingTag}
            ${priceTag}
            ${t._cancelledRevenue ? `<span class="text-muted">已取消 ¥${t._cancelledRevenue.toLocaleString()}</span>` : ''}
          </div>
        </div>
        <div class="team-card-actions">
          ${actions}
        </div>
      </div>
    `;
  }).join('');
}

function handleTeamAction(action, teamId) {
  const teams = getTeams();
  const team = teams.find(t => t.id === teamId);
  if (!team) return;

  switch (action) {
    case 'allocate':
      if (confirm(`确认给团队「${team.name}」分配 ${team.count} 间 ${RoomTypeLabels[team.roomType] || team.roomType}？`)) {
        const result = allocateTeam(teamId);
        if (result.ok) {
          showToast(`分房成功，分配 ${result.allocated || result.allocatedCount || result.success || 0} 间`);
          renderAll();
        } else {
          showToast((result.errors || [result.error || '分房失败']).join('；'), 'error');
        }
      }
      break;
    case 'reschedule':
      openRescheduleModal(teamId);
      break;
    case 'cancel-team':
    case 'cancel':
      if (confirm(`确认取消团队「${team.name}」的未入住预订？\n在住房间需先办理退房。`)) {
        const result = cancelAllTeamBookings(teamId, '团队取消');
        if (result.ok) {
          showToast(`已取消 ${result.cancelledCount || 0} 间预订`);
          renderAll();
        } else {
          showToast(result.error || '取消失败', 'error');
        }
      }
      break;
    case 'view':
      openTeamDetailModal(teamId);
      break;
  }
}

function openRescheduleModal(teamId) {
  const teams = getTeams();
  const team = teams.find(t => t.id === teamId);
  if (!team) return;

  const html = `
    <div class="modal-body">
      <h3 class="modal-title">团队改期 - ${team.name}</h3>
      <div class="form-group">
        <label>原入住日期</label>
        <input type="date" class="input" value="${team.checkInDate}" readonly />
      </div>
      <div class="form-group">
        <label>新入住日期</label>
        <input type="date" id="rs-new-date" class="input" value="${team.checkInDate}" min="${getToday()}" />
      </div>
      <div class="form-group">
        <label>入住天数</label>
        <input type="number" id="rs-nights" class="input" min="1" max="30" value="${team.nights}" />
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="window.__closeModal()">取消</button>
        <button class="btn btn-primary" id="btn-confirm-reschedule">确认改期</button>
      </div>
    </div>
  `;
  openModal(html);

  document.getElementById('btn-confirm-reschedule').addEventListener('click', () => {
    const newDate = document.getElementById('rs-new-date').value;
    const nights = parseInt(document.getElementById('rs-nights').value, 10);
    if (!newDate) {
      showToast('请选择入住日期', 'error');
      return;
    }
    if (!nights || nights < 1) {
      showToast('请输入有效的入住天数', 'error');
      return;
    }
    const result = rescheduleTeam(teamId, newDate, nights);
    if (result.ok) {
      showToast('改期成功');
      closeModal();
      renderAll();
    } else {
      showToast(result.error, 'error');
    }
  });
}

function openTeamDetailModal(teamId) {
  const allBookings = getTeamBookings(teamId);
  const activeBookings = allBookings.filter(b => b.status !== BookingStatus.CANCELLED);
  const cancelledBookings = allBookings.filter(b => b.status === BookingStatus.CANCELLED);
  const teams = getTeams();
  const team = teams.find(t => t.id === teamId);
  if (!team) return;

  const totalNights = activeBookings.reduce((s, b) => s + b.nights, 0);
  const totalRevenue = activeBookings.reduce((s, b) => s + b.totalPrice, 0);
  const avgRate = totalNights > 0 ? Math.round(totalRevenue / totalNights) : 0;
  const cancelledNights = cancelledBookings.reduce((s, b) => s + b.nights, 0);
  const cancelledRevenue = cancelledBookings.reduce((s, b) => s + b.totalPrice, 0);

  const roomsByType = {};
  activeBookings.forEach(b => {
    if (!roomsByType[b.roomType]) roomsByType[b.roomType] = { count: 0, nights: 0, revenue: 0 };
    roomsByType[b.roomType].count++;
    roomsByType[b.roomType].nights += b.nights;
    roomsByType[b.roomType].revenue += b.totalPrice;
  });

  const checkOutDate = team.checkOutDate || addDays(team.checkInDate, team.nights);

  const html = `
    <div class="modal-body">
      <h3 class="modal-title">${team.name} - 房间明细</h3>
      <div class="team-detail-summary">
        <div>
          <div class="sum-label">入住日期</div>
          <div class="sum-value">${formatDate(team.checkInDate)}</div>
        </div>
        <div>
          <div class="sum-label">离店日期</div>
          <div class="sum-value">${formatDate(checkOutDate)}</div>
        </div>
        <div>
          <div class="sum-label">总夜数</div>
          <div class="sum-value">${team.nights}晚</div>
        </div>
        <div>
          <div class="sum-label">实际房夜</div>
          <div class="sum-value">${totalNights}晚${cancelledNights ? ' <span class="text-muted">(-' + cancelledNights + '晚取消)</span>' : ''}</div>
        </div>
        <div>
          <div class="sum-label">总房费</div>
          <div class="sum-value sum-accent">¥${totalRevenue.toLocaleString()}${cancelledRevenue ? ' <span class="text-muted">(-¥' + cancelledRevenue.toLocaleString() + '取消)</span>' : ''}</div>
        </div>
        <div>
          <div class="sum-label">均价ADR</div>
          <div class="sum-value">¥${avgRate.toLocaleString()}</div>
        </div>
      </div>

      <div class="team-detail-typebreakdown">
        <div class="breakdown-title">房型汇总</div>
        <div class="type-row">
          ${Object.entries(roomsByType).map(([type, info]) => `
            <div class="type-item">
              <span class="type-label">${RoomTypeLabels[type] || type}</span>
              <span class="type-detail">${info.count}间 × ${info.nights}晚</span>
              <span class="type-value">¥${info.revenue.toLocaleString()}</span>
            </div>
          `).join('') || '<span class="text-muted">暂无房型数据（待分房）</span>'}
        </div>
      </div>

      <div class="section-title">房间明细（${activeBookings.length}间${cancelledBookings.length ? ' · 已取消' + cancelledBookings.length + '间' : ''}）</div>
      <div class="team-booking-list">
        ${allBookings.length === 0
          ? '<div class="empty-state">暂无房间记录，请先执行一键分房</div>'
          : allBookings
            .sort((a, b) => a.checkInDate.localeCompare(b.checkInDate) || a.roomNumber - b.roomNumber)
            .map(b => {
              const statusMap = {
                [BookingStatus.RESERVED]: { label: '已预订', tag: 'tag-warning' },
                [BookingStatus.CHECKED_IN]: { label: '客人在住', tag: 'tag-success' },
                [BookingStatus.CHECKED_OUT]: { label: '已离店', tag: 'tag-manual' },
                [BookingStatus.CANCELLED]: { label: '已取消', tag: 'tag-danger' }
              };
              const st = statusMap[b.status] || { label: b.status, tag: '' };
              const statusCls = b.status === BookingStatus.CANCELLED ? 'cancelled' : '';
              const canCancel = b.status === BookingStatus.RESERVED;
              return `
                <div class="team-booking-item ${statusCls}">
                  <div class="tbi-room">${b.roomNumber}房 · ${RoomTypeLabels[b.roomType] || b.roomType}</div>
                  <div class="tbi-info">
                    <span>${formatDate(b.checkInDate)}→${formatDate(b.checkOutDate)}</span>
                    <span>${b.nights}晚</span>
                    <span class="tag ${st.tag}">${st.label}</span>
                    <span>¥${b.dailyRate}/晚</span>
                    <span><strong>共¥${b.totalPrice.toLocaleString()}</strong></span>
                  </div>
                  ${canCancel ? `<button class="btn btn-outline btn-sm btn-danger" data-action="cancel-booking" data-team="${teamId}" data-booking="${b.id}" data-room="${b.roomId}">取消</button>` : ''}
                </div>
              `;
            }).join('')
        }
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" onclick="window.__closeModal()">关闭</button>
      </div>
    </div>
  `;
  openModal(html);

  document.querySelectorAll('[data-action="cancel-booking"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tid = e.target.dataset.team;
      const bid = e.target.dataset.booking;
      const rid = e.target.dataset.room;
      if (confirm('确认取消该房间预订？\n该操作将释放对应日期的房间库存。')) {
        const result = cancelTeamBooking(tid, bid, '团队单房取消');
        if (result.ok) {
          showToast('预订已取消');
          closeModal();
          renderAll();
        } else {
          showToast(result.error, 'error');
        }
      }
    });
  });
}

function renderReportsPage() {
  renderTrendChart(document.getElementById('trend-chart'), getTrendData(30));
  renderHeatmap(document.getElementById('heatmap-chart'), getBookingHeatmap(7));
  renderRevenueBreakdownCards();
  renderRevenueLedgerTable();
}

function renderRevenueBreakdownCards() {
  const breakdown = getRevenueBreakdown(7);
  const agg = breakdown.aggregate;
  const container = document.getElementById('revenue-cards');
  if (!container) return;

  const totalWalkIn = agg.walkInNights > 0 ? Math.round(agg.walkInRevenue / agg.walkInNights) : 0;
  const totalTeam = agg.teamNights > 0 ? Math.round(agg.teamRevenue / agg.teamNights) : 0;
  const totalManual = agg.manualNights > 0 ? Math.round(agg.manualRevenue / agg.manualNights) : 0;
  const totalDynamic = agg.dynamicNights > 0 ? Math.round(agg.dynamicRevenue / agg.dynamicNights) : 0;
  const totalNights = agg.walkInNights + agg.teamNights;
  const totalRevenueAll = agg.walkInRevenue + agg.teamRevenue;

  function pct(val, total) {
    if (!total) return '0%';
    return Math.round(100 * val / total) + '%';
  }

  container.innerHTML = `
    <div class="revenue-breakdown-grid">
      <div class="breakdown-card">
        <div class="breakdown-title">按客源分布（7日）</div>
        <div class="breakdown-row">
          <span class="breakdown-label">散客</span>
          <span class="breakdown-bar"><span class="bar bar-walkin" style="width:${pct(agg.walkInRevenue, totalRevenueAll)}"></span></span>
          <span class="breakdown-value">¥${agg.walkInRevenue.toLocaleString()}<small>${agg.walkInNights}晚</small></span>
        </div>
        <div class="breakdown-row">
          <span class="breakdown-label">团队</span>
          <span class="breakdown-bar"><span class="bar bar-team" style="width:${pct(agg.teamRevenue, totalRevenueAll)}"></span></span>
          <span class="breakdown-value">¥${agg.teamRevenue.toLocaleString()}<small>${agg.teamNights}晚</small></span>
        </div>
        <div class="breakdown-subrow">
          <span>散客ADR ¥${totalWalkIn} · 团队ADR ¥${totalTeam}</span>
          <span>占比 ${pct(agg.walkInRevenue, totalRevenueAll)} / ${pct(agg.teamRevenue, totalRevenueAll)}</span>
        </div>
      </div>

      <div class="breakdown-card">
        <div class="breakdown-title">按价格来源（7日）</div>
        <div class="breakdown-row">
          <span class="breakdown-label">动态价</span>
          <span class="breakdown-bar"><span class="bar bar-dynamic" style="width:${pct(agg.dynamicRevenue, totalRevenueAll)}"></span></span>
          <span class="breakdown-value">¥${agg.dynamicRevenue.toLocaleString()}<small>${agg.dynamicNights}晚</small></span>
        </div>
        <div class="breakdown-row">
          <span class="breakdown-label">手动价</span>
          <span class="breakdown-bar"><span class="bar bar-manual" style="width:${pct(agg.manualRevenue, totalRevenueAll)}"></span></span>
          <span class="breakdown-value">¥${agg.manualRevenue.toLocaleString()}<small>${agg.manualNights}晚</small></span>
        </div>
        <div class="breakdown-subrow">
          <span>动态价ADR ¥${totalDynamic} · 手动价ADR ¥${totalManual}</span>
          <span>占比 ${pct(agg.dynamicRevenue, totalRevenueAll)} / ${pct(agg.manualRevenue, totalRevenueAll)}</span>
        </div>
      </div>

      <div class="breakdown-card">
        <div class="breakdown-title">7日汇总</div>
        <div class="breakdown-summary-grid">
          <div><span class="sum-label">总房夜</span><span class="sum-value">${totalNights}晚</span></div>
          <div><span class="sum-label">总流水</span><span class="sum-value sum-accent">¥${totalRevenueAll.toLocaleString()}</span></div>
          <div><span class="sum-label">已入账</span><span class="sum-value text-success">¥${agg.totalRecognized.toLocaleString()}</span></div>
          <div><span class="sum-label">待入账</span><span class="sum-value text-warning">¥${agg.totalPending.toLocaleString()}</span></div>
          <div><span class="sum-label">已取消</span><span class="sum-value text-muted">¥${agg.totalCancelled.toLocaleString()}</span></div>
          <div><span class="sum-label">综合ADR</span><span class="sum-value">¥${totalNights ? Math.round(totalRevenueAll/totalNights) : 0}</span></div>
        </div>
      </div>
    </div>
  `;
}

function renderRevenueLedgerTable() {
  const breakdown = getRevenueBreakdown(7);
  const days = breakdown.days;
  const container = document.getElementById('ledger-table');
  if (!container) return;

  let totalRecognized = 0;
  let totalPending = 0;
  let totalCancelled = 0;
  let totalDynamic = 0;
  let totalManual = 0;
  let totalWalkIn = 0;
  let totalTeam = 0;

  const rows = days.map(d => {
    totalRecognized += d.recognized;
    totalPending += d.pending;
    totalCancelled += d.cancelled;
    totalDynamic += d.bySource?.dynamic || 0;
    totalManual += d.bySource?.manual || 0;
    totalWalkIn += d.byCustomer?.walkIn || 0;
    totalTeam += d.byCustomer?.team || 0;

    const isToday = d.date === getToday();
    const rowCls = isToday ? 'ledger-row-today' : '';

    return `
      <tr class="${rowCls}">
        <td>${formatDate(d.date)}${isToday ? ' <span class="tag tag-success">今日</span>' : ''}</td>
        <td class="text-right">${d.recognizedCount}间</td>
        <td class="text-right text-success">¥${d.recognized.toLocaleString()}</td>
        <td class="text-right">${d.pendingCount}间</td>
        <td class="text-right text-warning">¥${d.pending.toLocaleString()}</td>
        <td class="text-right">¥${(d.byCustomer?.walkIn || 0).toLocaleString()}</td>
        <td class="text-right">¥${(d.byCustomer?.team || 0).toLocaleString()}</td>
        <td class="text-right">¥${(d.bySource?.dynamic || 0).toLocaleString()}</td>
        <td class="text-right">¥${(d.bySource?.manual || 0).toLocaleString()}</td>
        <td class="text-right text-muted">¥${d.cancelled.toLocaleString()}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>营业日</th>
          <th class="text-right">已入账间</th>
          <th class="text-right">已入账</th>
          <th class="text-right">待入账间</th>
          <th class="text-right">待入账</th>
          <th class="text-right">散客房费</th>
          <th class="text-right">团队房费</th>
          <th class="text-right">动态价</th>
          <th class="text-right">手动价</th>
          <th class="text-right">取消金额</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
      <tfoot>
        <tr>
          <td><strong>7日合计</strong></td>
          <td class="text-right"><strong>${days.reduce((s, d) => s + d.recognizedCount, 0)}间</strong></td>
          <td class="text-right"><strong class="text-success">¥${totalRecognized.toLocaleString()}</strong></td>
          <td class="text-right"><strong>${days.reduce((s, d) => s + d.pendingCount, 0)}间</strong></td>
          <td class="text-right"><strong class="text-warning">¥${totalPending.toLocaleString()}</strong></td>
          <td class="text-right"><strong>¥${totalWalkIn.toLocaleString()}</strong></td>
          <td class="text-right"><strong>¥${totalTeam.toLocaleString()}</strong></td>
          <td class="text-right"><strong>¥${totalDynamic.toLocaleString()}</strong></td>
          <td class="text-right"><strong>¥${totalManual.toLocaleString()}</strong></td>
          <td class="text-right"><strong class="text-muted">¥${totalCancelled.toLocaleString()}</strong></td>
        </tr>
      </tfoot>
    </table>
  `;
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
      const totalRooms = results.reduce((s, t) => s + t.count, 0);
      resultEl.className = 'import-result success';
      resultEl.textContent = `成功导入 ${results.length} 个团队（共 ${totalRooms} 间）进入待分房池，请前往团队管理执行一键分房`;
      showToast(`团队导入成功（${results.length}个团队）`);
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

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const bookingId = btn.dataset.booking;
    const roomId = btn.dataset.room;
    const roomType = btn.dataset.type;
    const teamId = btn.dataset.team;

    if (['checkin', 'checkout', 'cancel', 'extend', 'change'].includes(action)) {
      e.preventDefault();
      handleFrontdeskAction(action, bookingId, roomId, { roomType });
    }
    if (['allocate', 'reschedule', 'cancel-team', 'view'].includes(action)) {
      e.preventDefault();
      handleTeamAction(action, teamId);
    }
  });

  window.addEventListener('hashchange', renderRoute);
  subscribe(renderAll);

  window.__test = {
    getTodayMetrics,
    getBookingHeatmap,
    getRooms,
    getToday,
    addDays,
    formatDate,
    canAcceptBooking,
    willBeOverbook,
    checkInRoom,
    reserveRoom,
    checkOutBooking,
    bulkBook,
    findAvailableRoom,
    getRoomDateStatus,
    countBookingsOnDate,
    getActiveBookingsForRoom,
    cancelBooking,
    extendBooking,
    changeRoom,
    getArrivalList,
    getInHouseList,
    getDepartureList,
    getRevenueLedger,
    getRevenueBreakdown,
    allocateTeam,
    rescheduleTeam,
    cancelTeamBooking,
    getTeamBookings,
    getTeams,
    createTeam,
    updateTeam,
    bulkBookTransactional,
    BookingStatus,
    RoomTypes,
    PriceSource,
    TeamStatus
  };
}

export {
  renderAll,
  bindEvents,
  showToast,
  closeModal,
  openModal
};
