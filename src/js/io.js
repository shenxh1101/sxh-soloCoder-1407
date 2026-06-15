import {
  RoomTypes,
  getRooms,
  saveRooms,
  getPricing,
  savePricing,
  getRevenueHistory,
  saveRevenueHistory,
  getToday,
  setToday,
  createDefaultRooms,
  createDefaultPricing,
  addDays
} from './state.js';

import { bulkBook, canAcceptBooking } from './rooms.js';

const RoomTypeMap = {
  '标准单人间': RoomTypes.SINGLE,
  '标准双人间': RoomTypes.DOUBLE,
  '豪华套房': RoomTypes.SUITE,
  '家庭套房': RoomTypes.FAMILY,
  'standard_single': RoomTypes.SINGLE,
  'standard_double': RoomTypes.DOUBLE,
  'luxury_suite': RoomTypes.SUITE,
  'family_suite': RoomTypes.FAMILY,
  'single': RoomTypes.SINGLE,
  'double': RoomTypes.DOUBLE,
  'suite': RoomTypes.SUITE,
  'family': RoomTypes.FAMILY
};

function exportSnapshot() {
  const snapshot = {
    version: '2.0',
    exportedAt: new Date().toISOString(),
    currentDate: getToday(),
    rooms: getRooms(),
    pricing: getPricing(),
    revenueHistory: getRevenueHistory()
  };
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hotel-snapshot-${snapshot.currentDate}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importSnapshot(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.rooms || !data.pricing) {
          reject(new Error('无效的快照文件格式'));
          return;
        }
        if (data.currentDate) setToday(data.currentDate);
        saveRooms(data.rooms);
        savePricing(data.pricing);
        if (data.revenueHistory) saveRevenueHistory(data.revenueHistory);
        resolve(data);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = line.split(',').map(v => v.trim());
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }
  return { headers, rows };
}

function parseTeamBookings(text) {
  const { rows } = parseCSV(text);
  const bookings = [];
  const errors = [];
  rows.forEach((row, idx) => {
    const teamName = row['团队名称'] || row['team'] || row['teamname'] || row['name'] || `团队${idx + 1}`;
    const typeRaw = row['房型'] || row['roomtype'] || row['type'] || '';
    const roomType = RoomTypeMap[typeRaw];
    const count = parseInt(row['房间数'] || row['count'] || row['rooms'] || '1', 10);
    const checkInDate = row['入住日期'] || row['checkin'] || row['checkindate'] || row['date'] || '';
    const nights = parseInt(row['入住天数'] || row['天数'] || row['nights'] || '1', 10);
    if (!roomType) {
      errors.push(`第${idx + 2}行: 无效的房型 "${typeRaw}"`);
      return;
    }
    if (!count || count < 1) {
      errors.push(`第${idx + 2}行: 无效的房间数量`);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkInDate)) {
      errors.push(`第${idx + 2}行: 日期格式应为 YYYY-MM-DD`);
      return;
    }
    if (!nights || nights < 1) {
      errors.push(`第${idx + 2}行: 无效的入住天数`);
      return;
    }
    const check = canAcceptBooking(roomType, checkInDate, nights);
    if (!check.ok) {
      errors.push(`第${idx + 2}行: ${typeRaw} 在 ${check.date} 已达超订上限（${check.used}/${check.allowed}），无法预订 ${count} 间`);
      return;
    }
    bookings.push({ teamName, roomType, count, checkInDate, nights });
  });
  return { bookings, errors };
}

function importTeamCSV(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const { bookings, errors } = parseTeamBookings(e.target.result);
        if (errors.length > 0) {
          reject(new Error(errors.join('\n')));
          return;
        }
        const result = bulkBook(bookings);
        if (result.errors.length > 0) {
          reject(new Error(result.errors.join('\n')));
          return;
        }
        resolve(result.results);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function generateSampleCSV() {
  const today = getToday();
  const tomorrow = addDays(today, 1);
  const content = [
    '团队名称,房型,房间数,入住日期,入住天数',
    `今日入住团,标准双人间,3,${today},3`,
    `明天预订团,豪华套房,2,${tomorrow},2`,
    `远期家庭团,家庭套房,4,${addDays(today, 7)},5`
  ].join('\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sample-team-bookings.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export {
  exportSnapshot,
  importSnapshot,
  parseCSV,
  parseTeamBookings,
  importTeamCSV,
  generateSampleCSV,
  RoomTypeMap
};
