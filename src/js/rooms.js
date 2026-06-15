import {
  RoomTypes,
  BookingStatus,
  getRooms,
  saveRooms,
  getPricing,
  getToday,
  addDays,
  appendRevenueRecord,
  getRevenueHistory,
  bookingDatesOverlap,
  datesOverlap,
  genId
} from './state.js';

import { calculateStayTotal } from './pricing.js';

function getRoomsByType(type) {
  return getRooms().filter(r => r.type === type);
}

function getActiveBookings(room) {
  return (room.bookings || []).filter(b => b.status !== BookingStatus.CHECKED_OUT);
}

function getBookingOnDate(room, dateStr) {
  return getActiveBookings(room).find(b =>
    dateStr >= b.checkInDate && dateStr < b.checkOutDate
  );
}

function hasConflict(room, checkInDate, checkOutDate, excludeBookingId = null) {
  return getActiveBookings(room).some(b => {
    if (excludeBookingId && b.id === excludeBookingId) return false;
    return bookingDatesOverlap(b, checkInDate, checkOutDate);
  });
}

function countBookingsOnDate(roomType, dateStr, opts = {}) {
  const { excludeOverbook = false } = opts;
  const rooms = getRoomsByType(roomType);
  let count = 0;
  rooms.forEach(room => {
    getActiveBookings(room).forEach(b => {
      if (!(dateStr >= b.checkInDate && dateStr < b.checkOutDate)) return;
      if (excludeOverbook && b.isOverbook) return;
      count++;
    });
  });
  return count;
}

function getRoomDateStatus(room, dateStr) {
  const matches = getActiveBookings(room).filter(b =>
    dateStr >= b.checkInDate && dateStr < b.checkOutDate
  );
  if (matches.length === 0) return { status: 'vacant' };
  const overbook = matches.find(b => b.isOverbook);
  const b = overbook || matches[0];
  return {
    status: b.status === BookingStatus.CHECKED_IN ? 'checked_in' : 'reserved',
    booking: b,
    isOverbook: !!overbook,
    allBookings: matches
  };
}

function getRoomStats(dateStr = null) {
  const date = dateStr || getToday();
  const stats = {};
  Object.values(RoomTypes).forEach(type => {
    const typeRooms = getRoomsByType(type);
    let vacant = 0, checkedIn = 0, reserved = 0, overbook = 0;
    typeRooms.forEach(room => {
      const s = getRoomDateStatus(room, date);
      if (s.status === 'vacant') vacant++;
      else if (s.status === 'checked_in') checkedIn++;
      else {
        reserved++;
        if (s.isOverbook) overbook++;
      }
    });
    stats[type] = {
      total: typeRooms.length,
      vacant,
      occupied: checkedIn,
      reserved: reserved - overbook,
      overbook,
      used: checkedIn + reserved
    };
  });
  return stats;
}

function getOverbookingRisk(dateStr = null) {
  const date = dateStr || getToday();
  const pricing = getPricing();
  const threshold = pricing.overbookingThreshold;
  const stats = getRoomStats(date);
  const risks = [];
  Object.entries(stats).forEach(([type, s]) => {
    const allowed = Math.ceil(s.total * (1 + threshold));
    const normalUsed = s.occupied + s.reserved;
    const totalUsed = normalUsed + s.overbook;
    const ratio = normalUsed / s.total;
    risks.push({
      type,
      date,
      normalUsed,
      overbookUsed: s.overbook,
      totalUsed,
      total: s.total,
      allowed,
      ratio,
      isAtRisk: normalUsed >= s.total,
      canAccept: totalUsed < allowed,
      canAcceptNormal: normalUsed < s.total
    });
  });
  return risks;
}

function countDatesInRange(checkInDate, checkOutDate) {
  const dates = [];
  let d = checkInDate;
  while (d < checkOutDate) {
    dates.push(d);
    d = addDays(d, 1);
  }
  return dates;
}

function canAcceptBooking(roomType, checkInDate, nights) {
  const pricing = getPricing();
  const threshold = pricing.overbookingThreshold;
  const perType = 10;
  const allowed = Math.ceil(perType * (1 + threshold));
  const checkOutDate = addDays(checkInDate, nights);
  const dates = countDatesInRange(checkInDate, checkOutDate);
  for (const date of dates) {
    const used = countBookingsOnDate(roomType, date);
    if (used >= allowed) return { ok: false, date, used, allowed };
  }
  return { ok: true };
}

function willBeOverbook(roomType, checkInDate, nights) {
  const perType = 10;
  const checkOutDate = addDays(checkInDate, nights);
  const dates = countDatesInRange(checkInDate, checkOutDate);
  for (const date of dates) {
    const used = countBookingsOnDate(roomType, date);
    if (used >= perType) return true;
  }
  return false;
}

function findAvailableRoom(roomType, checkInDate, nights) {
  const checkOutDate = addDays(checkInDate, nights);
  const rooms = getRoomsByType(roomType).sort((a, b) => a.number - b.number);
  for (const room of rooms) {
    if (!hasConflict(room, checkInDate, checkOutDate)) return room;
  }
  return null;
}

function createBooking(roomId, options) {
  const {
    guestName,
    checkInDate,
    nights,
    manualRate = null,
    status = BookingStatus.CHECKED_IN
  } = options;
  if (!guestName || !checkInDate || !nights) {
    throw new Error('客人姓名、入住日期和入住天数不能为空');
  }
  const rooms = getRooms();
  const room = rooms.find(r => r.id === roomId);
  if (!room) throw new Error('房间不存在');
  const checkOutDate = addDays(checkInDate, nights);
  const check = canAcceptBooking(room.type, checkInDate, nights);
  if (!check.ok) {
    throw new Error(`该房型在 ${check.date} 已达超订上限（${check.used}/${check.allowed}），无法新增预订`);
  }
  const isOverbook = willBeOverbook(room.type, checkInDate, nights);
  if (!isOverbook && hasConflict(room, checkInDate, checkOutDate)) {
    throw new Error('该房间在所选日期已有预订，存在日期冲突');
  }
  let totalPrice, dailyBreakdown, dailyRate;
  if (manualRate && manualRate > 0) {
    dailyRate = Math.round(manualRate);
    totalPrice = dailyRate * nights;
    dailyBreakdown = countDatesInRange(checkInDate, checkOutDate).map(date => ({
      date, rate: dailyRate
    }));
  } else {
    const calc = calculateStayTotal(room.type, checkInDate, nights);
    totalPrice = calc.total;
    dailyBreakdown = calc.dailyBreakdown;
    dailyRate = nights > 0 ? Math.round(totalPrice / nights) : 0;
  }
  const booking = {
    id: genId('bk'),
    guestName,
    checkInDate,
    checkOutDate,
    nights,
    dailyRate,
    totalPrice,
    dailyBreakdown,
    bookingDate: getToday(),
    status,
    isOverbook
  };
  room.bookings = room.bookings || [];
  room.bookings.push(booking);
  saveRooms(rooms);
  return { room, booking };
}

function checkInRoom(roomId, options) {
  return createBooking(roomId, { ...options, status: BookingStatus.CHECKED_IN });
}

function reserveRoom(roomId, options) {
  return createBooking(roomId, { ...options, status: BookingStatus.RESERVED });
}

function checkOutBooking(roomId, bookingId) {
  const rooms = getRooms();
  const room = rooms.find(r => r.id === roomId);
  if (!room) throw new Error('房间不存在');
  const booking = (room.bookings || []).find(b => b.id === bookingId);
  if (!booking) throw new Error('预订记录不存在');
  if (booking.status === BookingStatus.CHECKED_OUT) {
    throw new Error('该订单已退房');
  }
  const revenue = booking.totalPrice || (booking.dailyRate || 0) * (booking.nights || 0);
  const today = getToday();
  const history = getRevenueHistory();
  const todayRecord = history.find(r => r.date === today) || {
    date: today,
    revenue: 0,
    occupiedRooms: 0,
    soldRooms: 0
  };
  todayRecord.revenue += revenue;
  todayRecord.soldRooms += booking.nights || 1;
  let activeToday = 0;
  rooms.forEach(r => {
    (r.bookings || []).forEach(b => {
      if (b.id === bookingId) return;
      if (b.status === BookingStatus.CHECKED_OUT) return;
      if (today >= b.checkInDate && today < b.checkOutDate) activeToday++;
    });
  });
  todayRecord.occupiedRooms = activeToday;
  appendRevenueRecord(todayRecord);
  const savedGuest = booking.guestName;
  const savedTotal = revenue;
  booking.status = BookingStatus.CHECKED_OUT;
  booking.checkOutActualDate = today;
  saveRooms(rooms);
  return { guestName: savedGuest, total: savedTotal, roomId, bookingId };
}

function getActiveBookingsForRoom(room) {
  return (room.bookings || []).filter(b => b.status !== BookingStatus.CHECKED_OUT);
}

function bulkBook(bookings) {
  const results = [];
  const errors = [];
  for (const b of bookings) {
    for (let i = 0; i < b.count; i++) {
      const check = canAcceptBooking(b.roomType, b.checkInDate, b.nights);
      if (!check.ok) {
        errors.push(`${b.teamName || '团队'}-${i + 1}: ${b.roomType} 在 ${check.date} 超订上限（已用${check.used}/${check.allowed}）`);
        continue;
      }
      let room = findAvailableRoom(b.roomType, b.checkInDate, b.nights);
      if (!room) {
        const typedRooms = getRoomsByType(b.roomType);
        room = typedRooms[0];
        if (!room) {
          errors.push(`${b.teamName || '团队'}-${i + 1}: 房型不存在`);
          continue;
        }
      }
      try {
        const r = reserveRoom(room.id, {
          guestName: `${b.teamName || '团队'}-${i + 1}`,
          checkInDate: b.checkInDate,
          nights: b.nights
        });
        results.push(r);
      } catch (e) {
        errors.push(`${room.id}: ${e.message}`);
      }
    }
  }
  return { results, errors };
}

export {
  getRoomsByType,
  getActiveBookings,
  getBookingOnDate,
  getRoomDateStatus,
  hasConflict,
  countBookingsOnDate,
  getRoomStats,
  getOverbookingRisk,
  canAcceptBooking,
  willBeOverbook,
  findAvailableRoom,
  checkInRoom,
  reserveRoom,
  checkOutBooking,
  getActiveBookingsForRoom,
  bulkBook,
  countDatesInRange
};
