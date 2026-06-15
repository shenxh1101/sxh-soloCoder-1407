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

const RoomStatus = {
  VACANT: 'vacant',
  OCCUPIED: 'occupied',
  RESERVED: 'reserved'
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

function getToday() {
  return loadFromStorage(STORAGE_KEYS.TODAY, formatDate(new Date()));
}

function setToday(dateStr) {
  saveToStorage(STORAGE_KEYS.TODAY, dateStr);
  notify();
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
        status: RoomStatus.VACANT
      });
    }
  });
  return rooms;
}

function getRooms() {
  return loadFromStorage(STORAGE_KEYS.ROOMS, createDefaultRooms());
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
  return loadFromStorage(STORAGE_KEYS.PRICING, createDefaultPricing());
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
  return loadFromStorage(STORAGE_KEYS.REVENUE, createDefaultRevenueHistory());
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
  RoomStatus,
  STORAGE_KEYS,
  subscribe,
  getToday,
  setToday,
  formatDate,
  addDays,
  diffDays,
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
