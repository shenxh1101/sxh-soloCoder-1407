import {
  RoomTypes,
  RoomStatus,
  getRooms,
  saveRooms,
  getPricing,
  getToday,
  addDays,
  appendRevenueRecord,
  getRevenueHistory
} from './state.js';

import { calculateStayTotal } from './pricing.js';

function getRoomsByType(type) {
  return getRooms().filter(r => r.type === type);
}

function countByStatus(rooms, status) {
  return rooms.filter(r => r.status === status).length;
}

function getRoomStats() {
  const rooms = getRooms();
  const stats = {};
  Object.values(RoomTypes).forEach(type => {
    const typeRooms = rooms.filter(r => r.type === type);
    stats[type] = {
      total: typeRooms.length,
      vacant: countByStatus(typeRooms, RoomStatus.VACANT),
      occupied: countByStatus(typeRooms, RoomStatus.OCCUPIED),
      reserved: countByStatus(typeRooms, RoomStatus.RESERVED)
    };
  });
  return stats;
}

function getOverbookingRisk() {
  const pricing = getPricing();
  const threshold = pricing.overbookingThreshold;
  const stats = getRoomStats();
  const risks = [];
  Object.entries(stats).forEach(([type, s]) => {
    const used = s.occupied + s.reserved;
    const allowed = Math.ceil(s.total * (1 + threshold));
    const ratio = used / s.total;
    risks.push({
      type,
      used,
      total: s.total,
      allowed,
      ratio,
      isAtRisk: used >= s.total,
      canAccept: used < allowed
    });
  });
  return risks;
}

function canCheckIn(roomType, count = 1) {
  const risks = getOverbookingRisk();
  const risk = risks.find(r => r.type === roomType);
  if (!risk) return false;
  return (risk.used + count) <= risk.allowed;
}

function findVacantRooms(roomType, count = 1) {
  const rooms = getRoomsByType(roomType);
  return rooms.filter(r => r.status === RoomStatus.VACANT).slice(0, count);
}

function checkInRoom(roomId, options) {
  const {
    guestName,
    checkInDate,
    nights,
    status = RoomStatus.OCCUPIED
  } = options;
  if (!guestName || !checkInDate || !nights) {
    throw new Error('客人姓名、入住日期和入住天数不能为空');
  }
  const rooms = getRooms();
  const room = rooms.find(r => r.id === roomId);
  if (!room) throw new Error('房间不存在');
  if (room.status !== RoomStatus.VACANT) {
    throw new Error('该房间不是空闲状态');
  }
  if (!canCheckIn(room.type, 1)) {
    throw new Error('该房型已达超订上限，无法办理入住');
  }
  const { total, dailyBreakdown } = calculateStayTotal(room.type, checkInDate, nights);
  const avgRate = nights > 0 ? Math.round(total / nights) : 0;
  room.status = status;
  room.guestName = guestName;
  room.checkInDate = checkInDate;
  room.checkOutDate = addDays(checkInDate, nights);
  room.nights = nights;
  room.dailyRate = avgRate;
  room.totalPrice = total;
  room.dailyBreakdown = dailyBreakdown;
  room.bookingDate = getToday();
  saveRooms(rooms);
  return { room, total, dailyBreakdown };
}

function checkOutRoom(roomId) {
  const rooms = getRooms();
  const room = rooms.find(r => r.id === roomId);
  if (!room) throw new Error('房间不存在');
  if (room.status === RoomStatus.VACANT) {
    throw new Error('该房间当前为空房');
  }
  const revenue = room.totalPrice || (room.dailyRate || 0) * (room.nights || 0);
  const today = getToday();
  const history = getRevenueHistory();
  const todayRecord = history.find(r => r.date === today) || {
    date: today,
    revenue: 0,
    occupiedRooms: 0,
    soldRooms: 0
  };
  todayRecord.revenue += revenue;
  todayRecord.soldRooms += room.nights || 1;
  todayRecord.occupiedRooms = rooms.filter(
    r => r.status !== RoomStatus.VACANT && r.id !== roomId
  ).length;
  appendRevenueRecord(todayRecord);
  const savedGuest = room.guestName;
  const savedTotal = revenue;
  room.status = RoomStatus.VACANT;
  delete room.guestName;
  delete room.checkInDate;
  delete room.checkOutDate;
  delete room.nights;
  delete room.dailyRate;
  delete room.totalPrice;
  delete room.dailyBreakdown;
  delete room.bookingDate;
  saveRooms(rooms);
  return { guestName: savedGuest, total: savedTotal, roomId };
}

function bulkCheckIn(bookings) {
  const results = [];
  const errors = [];
  for (const b of bookings) {
    const vacant = findVacantRooms(b.roomType, b.count);
    if (vacant.length < b.count) {
      errors.push(`${b.teamName || '团队'}: ${b.roomType} 房间不足`);
      continue;
    }
    for (let i = 0; i < b.count; i++) {
      try {
        const r = checkInRoom(vacant[i].id, {
          guestName: `${b.teamName || '团队'}-${i + 1}`,
          checkInDate: b.checkInDate,
          nights: b.nights,
          status: RoomStatus.RESERVED
        });
        results.push(r);
      } catch (e) {
        errors.push(`${vacant[i].id}: ${e.message}`);
      }
    }
  }
  return { results, errors };
}

export {
  getRoomsByType,
  countByStatus,
  getRoomStats,
  getOverbookingRisk,
  canCheckIn,
  findVacantRooms,
  checkInRoom,
  checkOutRoom,
  bulkCheckIn
};
