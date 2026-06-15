const STORAGE_KEYS = {
  ROOMS: 'hotel_rooms_state',
  PRICING: 'hotel_pricing_config',
  REVENUE: 'hotel_revenue_history',
  TODAY: 'hotel_current_date'
};

const RoomTypes = {
  SINGLE: 'standard_single',
  DOUBLE: 'standard_double',
  SUITE: 'luxury_suite',
  FAMILY: 'family_suite'
};

const RoomTypeLabels = {
  [RoomTypes.SINGLE]: '标准单人间',
  [RoomTypes.DOUBLE]: '标准双人间',
  [RoomTypes.SUITE]: '豪华套房',
  [RoomTypes.FAMILY]: '家庭套房'
};

const RoomTypePrefix = {
  [RoomTypes.SINGLE]: 'S',
  [RoomTypes.DOUBLE]: 'D',
  [RoomTypes.SUITE]: 'L',
  [RoomTypes.FAMILY]: 'F'
};

const BookingStatus = {
  RESERVED: 'reserved',
  CHECKED_IN: 'checked_in',
  CHECKED_OUT: 'checked_out'
};

const listeners = new Set();

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach(fn => fn());
}

function loadFromStorage(key, defaultValue) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw);
  } catch {
    return defaultValue;
  }
}

function saveToStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function formatDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

function diffDays(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  return Math.round((e - s) / (1000 * 60 * 60 * 24));
}

function datesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function bookingDatesOverlap(booking, checkInDate, checkOutDate) {
  if (booking.status === BookingStatus.CHECKED_OUT) return false;
  return datesOverlap(booking.checkInDate, booking.checkOutDate, checkInDate, checkOutDate);
}

function genId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function getToday() {
  return loadFromStorage(STORAGE_KEYS.TODAY, formatDate(new Date()));
}

function setToday(dateStr) {
  saveToStorage(STORAGE_KEYS.TODAY, dateStr);
  notify();
}

function migrateLegacyRoom(room) {
  if (room.bookings) return room;
  const bookings = [];
  if (room.status && room.status !== 'vacant') {
    const bookingStatus = room.status === 'occupied' ? BookingStatus.CHECKED_IN : BookingStatus.RESERVED;
    if (room.checkInDate && room.checkOutDate) {
      bookings.push({
        id: genId('bk'),
        guestName: room.guestName || '未命名客人',
        checkInDate: room.checkInDate,
        checkOutDate: room.checkOutDate,
        nights: room.nights || diffDays(room.checkInDate, room.checkOutDate),
        dailyRate: room.dailyRate || 0,
        totalPrice: room.totalPrice || 0,
        dailyBreakdown: room.dailyBreakdown || [],
        bookingDate: room.bookingDate || getToday(),
        status: bookingStatus,
        isOverbook: false
      });
    }
  }
  return {
    id: room.id,
    type: room.type,
    number: room.number,
    bookings
  };
}

function createDefaultRooms() {
  const rooms = [];
  const types = [RoomTypes.SINGLE, RoomTypes.DOUBLE, RoomTypes.SUITE, RoomTypes.FAMILY];
  types.forEach(type => {
    for (let i = 1; i <= 10; i++) {
      rooms.push({
        id: `${RoomTypePrefix[type]}-${String(i).padStart(2, '0')}`,
        type,
        number: i,
        bookings: []
      });
    }
  });
  return rooms;
}

function getRooms() {
  const raw = localStorage.getItem(STORAGE_KEYS.ROOMS);
  if (raw === null) {
    const def = createDefaultRooms();
    saveToStorage(STORAGE_KEYS.ROOMS, def);
    return def;
  }
  try {
    return JSON.parse(raw).map(migrateLegacyRoom);
  } catch {
    const def = createDefaultRooms();
    saveToStorage(STORAGE_KEYS.ROOMS, def);
    return def;
  }
}

function saveRooms(rooms) {
  saveToStorage(STORAGE_KEYS.ROOMS, rooms);
  notify();
}

function createDefaultPricing() {
  return {
    basePrices: {
      [RoomTypes.SINGLE]: 388,
      [RoomTypes.DOUBLE]: 588,
      [RoomTypes.SUITE]: 1288,
      [RoomTypes.FAMILY]: 988
    },
    peakSeasons: [],
    advanceDiscounts: [
      { daysAhead: 14, discountRate: 0.85 },
      { daysAhead: 7, discountRate: 0.9 }
    ],
    overbookingThreshold: 0.05
  };
}

function getPricing() {
  const raw = localStorage.getItem(STORAGE_KEYS.PRICING);
  if (raw === null) {
    const def = createDefaultPricing();
    saveToStorage(STORAGE_KEYS.PRICING, def);
    return def;
  }
  try {
    return JSON.parse(raw);
  } catch {
    const def = createDefaultPricing();
    saveToStorage(STORAGE_KEYS.PRICING, def);
    return def;
  }
}

function savePricing(pricing) {
  saveToStorage(STORAGE_KEYS.PRICING, pricing);
  notify();
}

function createDefaultRevenueHistory() {
  const history = [];
  const today = getToday();
  for (let i = 29; i >= 0; i--) {
    const date = addDays(today, -i);
    const occupied = Math.floor(Math.random() * 20) + 15;
    const sold = occupied + Math.floor(Math.random() * 5);
    const avgRate = 500 + Math.random() * 300;
    history.push({
      date,
      revenue: Math.round(sold * avgRate),
      occupiedRooms: occupied,
      soldRooms: sold
    });
  }
  return history;
}

function getRevenueHistory() {
  const raw = localStorage.getItem(STORAGE_KEYS.REVENUE);
  if (raw === null) {
    const def = createDefaultRevenueHistory();
    saveToStorage(STORAGE_KEYS.REVENUE, def);
    return def;
  }
  try {
    return JSON.parse(raw);
  } catch {
    const def = createDefaultRevenueHistory();
    saveToStorage(STORAGE_KEYS.REVENUE, def);
    return def;
  }
}

function saveRevenueHistory(history) {
  saveToStorage(STORAGE_KEYS.REVENUE, history);
  notify();
}

function appendRevenueRecord(record) {
  const history = getRevenueHistory();
  const existing = history.findIndex(r => r.date === record.date);
  if (existing >= 0) {
    history[existing] = record;
  } else {
    history.push(record);
  }
  while (history.length > 30) history.shift();
  saveRevenueHistory(history);
}

function resetAllData() {
  localStorage.removeItem(STORAGE_KEYS.ROOMS);
  localStorage.removeItem(STORAGE_KEYS.PRICING);
  localStorage.removeItem(STORAGE_KEYS.REVENUE);
  localStorage.removeItem(STORAGE_KEYS.TODAY);
  notify();
}

export {
  RoomTypes,
  RoomTypeLabels,
  RoomTypePrefix,
  BookingStatus,
  STORAGE_KEYS,
  subscribe,
  getToday,
  setToday,
  formatDate,
  addDays,
  diffDays,
  datesOverlap,
  bookingDatesOverlap,
  genId,
  getRooms,
  saveRooms,
  getPricing,
  savePricing,
  getRevenueHistory,
  saveRevenueHistory,
  appendRevenueRecord,
  resetAllData,
  createDefaultRooms,
  createDefaultPricing
};
