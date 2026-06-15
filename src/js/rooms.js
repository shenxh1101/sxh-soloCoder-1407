import {
  RoomTypes,
  BookingStatus,
  PriceSource,
  TeamStatus,
  getRooms,
  saveRooms,
  getPricing,
  getToday,
  addDays,
  appendRevenueRecord,
  getRevenueHistory,
  bookingDatesOverlap,
  datesOverlap,
  genId,
  getTeams,
  saveTeams,
  updateTeam
} from './state.js';

import { calculateStayTotal } from './pricing.js';

function getRoomsByType(type) {
  return getRooms().filter(r => r.type === type);
}

function getActiveBookings(room) {
  return (room.bookings || []).filter(b =>
    b.status !== BookingStatus.CHECKED_OUT && b.status !== BookingStatus.CANCELLED
  );
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
    status = BookingStatus.CHECKED_IN,
    teamId = null,
    teamName = null,
    skipAvailabilityCheck = false
  } = options;
  if (!guestName || !checkInDate || !nights) {
    throw new Error('客人姓名、入住日期和入住天数不能为空');
  }
  const rooms = getRooms();
  const room = rooms.find(r => r.id === roomId);
  if (!room) throw new Error('房间不存在');
  const checkOutDate = addDays(checkInDate, nights);
  if (!skipAvailabilityCheck) {
    const check = canAcceptBooking(room.type, checkInDate, nights);
    if (!check.ok) {
      throw new Error(`该房型在 ${check.date} 已达超订上限（${check.used}/${check.allowed}），无法新增预订`);
    }
  }
  const isOverbook = skipAvailabilityCheck ? false : willBeOverbook(room.type, checkInDate, nights);
  if (!isOverbook && hasConflict(room, checkInDate, checkOutDate)) {
    throw new Error('该房间在所选日期已有预订，存在日期冲突');
  }
  const priceSource = manualRate && manualRate > 0 ? PriceSource.MANUAL : PriceSource.DYNAMIC;
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
    isOverbook,
    priceSource,
    teamId,
    teamName,
    cancelledAt: null,
    cancellationReason: null,
    roomId: room.id
  };
  room.bookings = room.bookings || [];
  room.bookings.push(booking);
  saveRooms(rooms);
  return { room, booking };
}

function checkInRoom(roomId, options) {
  const { bookingId, guestName, manualRate = null } = options;
  const rooms = getRooms();
  const room = rooms.find(r => r.id === roomId);
  if (!room) throw new Error('房间不存在');

  if (bookingId) {
    const booking = (room.bookings || []).find(b => b.id === bookingId);
    if (!booking) throw new Error('预订记录不存在');
    if (booking.status === BookingStatus.CHECKED_IN) throw new Error('该预订已入住');
    if (booking.status === BookingStatus.CHECKED_OUT) throw new Error('该预订已退房');
    if (booking.status === BookingStatus.CANCELLED) throw new Error('该预订已取消');

    if (guestName) booking.guestName = guestName;

    if (manualRate && manualRate > 0) {
      const newRate = Math.round(manualRate);
      booking.priceSource = PriceSource.MANUAL;
      booking.dailyRate = newRate;
      booking.totalPrice = newRate * booking.nights;
      booking.dailyBreakdown = countDatesInRange(booking.checkInDate, booking.checkOutDate).map(date => ({
        date, rate: newRate
      }));
    }

    booking.status = BookingStatus.CHECKED_IN;
    booking.checkInActualDate = getToday();
    saveRooms(rooms);
    return { ok: true, room, booking };
  }

  const result = createBooking(roomId, { ...options, status: BookingStatus.CHECKED_IN });
  return { ok: true, room: result.room, booking: result.booking };
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
  return { ok: true, guestName: savedGuest, revenue: savedTotal, total: savedTotal, roomId, bookingId };
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

function bulkBookTransactional(bookings) {
  const rooms = getRooms();
  const roomsSnapshot = JSON.parse(JSON.stringify(rooms));
  const results = [];
  const errors = [];
  try {
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
        const r = reserveRoom(room.id, {
          guestName: `${b.teamName || '团队'}-${i + 1}`,
          checkInDate: b.checkInDate,
          nights: b.nights,
          manualRate: b.manualRate || null,
          teamId: b.teamId || null,
          teamName: b.teamName || null
        });
        results.push(r);
      }
    }
    if (errors.length > 0) {
      saveRooms(roomsSnapshot);
      return { ok: false, results: [], errors, rolledBack: true };
    }
    return { ok: true, results, errors: [], rolledBack: false };
  } catch (e) {
    saveRooms(roomsSnapshot);
    return { ok: false, results: [], errors: [e.message], rolledBack: true };
  }
}

function cancelBooking(roomId, bookingId, reason = '') {
  const rooms = getRooms();
  const room = rooms.find(r => r.id === roomId);
  if (!room) throw new Error('房间不存在');
  const booking = (room.bookings || []).find(b => b.id === bookingId);
  if (!booking) throw new Error('预订记录不存在');
  if (booking.status === BookingStatus.CHECKED_OUT) {
    throw new Error('已结账订单不能取消');
  }
  if (booking.status === BookingStatus.CANCELLED) {
    throw new Error('订单已取消');
  }
  if (booking.status === BookingStatus.CHECKED_IN) {
    throw new Error('客人已在住，请先办理退房');
  }
  const today = getToday();
  booking.status = BookingStatus.CANCELLED;
  booking.cancelledAt = today;
  booking.cancellationReason = reason;
  saveRooms(rooms);
  if (booking.teamId) {
    const teams = getTeams();
    const team = teams.find(t => t.id === booking.teamId);
    if (team) {
      team.cancelledCount = (team.cancelledCount || 0) + 1;
      team.bookingIds = (team.bookingIds || []).filter(id => id !== bookingId);
      if (team.cancelledCount >= team.count) {
        team.status = TeamStatus.CANCELLED;
      } else if (team.status === TeamStatus.ALLOCATED) {
        team.status = TeamStatus.PARTIAL;
      }
      saveTeams(teams);
    }
  }
  return { ok: true, room, booking };
}

function extendBooking(roomId, bookingId, extraNights) {
  if (!extraNights || extraNights <= 0) throw new Error('延住天数必须大于0');
  const rooms = getRooms();
  const room = rooms.find(r => r.id === roomId);
  if (!room) throw new Error('房间不存在');
  const booking = (room.bookings || []).find(b => b.id === bookingId);
  if (!booking) throw new Error('预订记录不存在');
  if (booking.status === BookingStatus.CHECKED_OUT) throw new Error('订单已退房');
  if (booking.status === BookingStatus.CANCELLED) throw new Error('订单已取消');
  const newCheckOutDate = addDays(booking.checkOutDate, extraNights);
  const conflictCheck = hasConflict(room, booking.checkOutDate, newCheckOutDate, bookingId);
  if (conflictCheck && !booking.isOverbook) {
    throw new Error('延住日期与该房间其他预订冲突');
  }
  const remainingNights = extraNights;
  let extraRevenue = 0;
  const extraBreakdown = [];
  for (let i = 0; i < remainingNights; i++) {
    const date = addDays(booking.checkOutDate, i);
    const rate = booking.dailyRate;
    extraRevenue += rate;
    extraBreakdown.push({ date, rate });
  }
  booking.nights += extraNights;
  booking.checkOutDate = newCheckOutDate;
  booking.totalPrice += extraRevenue;
  booking.dailyBreakdown = [...booking.dailyBreakdown, ...extraBreakdown];
  saveRooms(rooms);
  return { ok: true, room, booking, extraRevenue, newCheckOutDate };
}

function changeRoom(bookingId, fromRoomId, toRoomId) {
  if (fromRoomId === toRoomId) throw new Error('新房与原房相同');
  const rooms = getRooms();
  const fromRoom = rooms.find(r => r.id === fromRoomId);
  const toRoom = rooms.find(r => r.id === toRoomId);
  if (!fromRoom || !toRoom) throw new Error('房间不存在');
  if (fromRoom.type !== toRoom.type) {
    throw new Error('换房只能在相同房型之间进行');
  }
  const bookingIdx = (fromRoom.bookings || []).findIndex(b => b.id === bookingId);
  if (bookingIdx < 0) throw new Error('原房间无此预订');
  const booking = fromRoom.bookings[bookingIdx];
  if (booking.status === BookingStatus.CHECKED_OUT) throw new Error('已退房订单不能换房');
  if (booking.status === BookingStatus.CANCELLED) throw new Error('已取消订单不能换房');
  if (!booking.isOverbook && hasConflict(toRoom, booking.checkInDate, booking.checkOutDate)) {
    throw new Error('目标房间在所选日期已有预订');
  }
  fromRoom.bookings.splice(bookingIdx, 1);
  booking.roomId = toRoomId;
  toRoom.bookings = toRoom.bookings || [];
  toRoom.bookings.push(booking);
  saveRooms(rooms);
  return { ok: true, fromRoom, toRoom, booking };
}

function getArrivalList() {
  const today = getToday();
  const arrivals = [];
  getRooms().forEach(room => {
    (room.bookings || []).forEach(b => {
      if (b.status !== BookingStatus.RESERVED) return;
      if (b.checkInDate !== today) return;
      arrivals.push({
        bookingId: b.id,
        roomId: room.id,
        roomNumber: room.number,
        roomType: room.type,
        guestName: b.guestName,
        checkInDate: b.checkInDate,
        checkOutDate: b.checkOutDate,
        nights: b.nights,
        dailyRate: b.dailyRate,
        totalPrice: b.totalPrice,
        priceSource: b.priceSource,
        teamId: b.teamId,
        teamName: b.teamName,
        isOverbook: b.isOverbook
      });
    });
  });
  return arrivals.sort((a, b) => a.roomNumber - b.roomNumber);
}

function getInHouseList() {
  const today = getToday();
  const inHouse = [];
  getRooms().forEach(room => {
    (room.bookings || []).forEach(b => {
      if (b.status !== BookingStatus.CHECKED_IN) return;
      if (!(today >= b.checkInDate && today < b.checkOutDate)) return;
      inHouse.push({
        bookingId: b.id,
        roomId: room.id,
        roomNumber: room.number,
        roomType: room.type,
        guestName: b.guestName,
        checkInDate: b.checkInDate,
        checkOutDate: b.checkOutDate,
        nights: b.nights,
        remainingNights: (b.checkOutDate > today) ? Math.ceil((new Date(b.checkOutDate) - new Date(today)) / (1000 * 60 * 60 * 24)) : 0,
        dailyRate: b.dailyRate,
        totalPrice: b.totalPrice,
        priceSource: b.priceSource,
        teamId: b.teamId,
        teamName: b.teamName,
        isOverbook: b.isOverbook
      });
    });
  });
  return inHouse.sort((a, b) => a.roomNumber - b.roomNumber);
}

function getDepartureList() {
  const today = getToday();
  const tomorrow = addDays(today, 1);
  const departures = [];
  getRooms().forEach(room => {
    (room.bookings || []).forEach(b => {
      if (b.status !== BookingStatus.CHECKED_IN) return;
      if (b.checkOutDate !== tomorrow) return;
      departures.push({
        bookingId: b.id,
        roomId: room.id,
        roomNumber: room.number,
        roomType: room.type,
        guestName: b.guestName,
        checkInDate: b.checkInDate,
        checkOutDate: b.checkOutDate,
        nights: b.nights,
        dailyRate: b.dailyRate,
        totalPrice: b.totalPrice,
        priceSource: b.priceSource,
        teamId: b.teamId,
        teamName: b.teamName
      });
    });
  });
  return departures.sort((a, b) => a.roomNumber - b.roomNumber);
}

function getRevenueLedger(dateStr) {
  const rooms = getRooms();
  const ledger = {
    date: dateStr,
    checkedIn: [],
    reserved: [],
    checkedOut: [],
    cancelled: [],
    totals: {
      checkedInRevenue: 0,
      reservedRevenue: 0,
      checkedOutRevenue: 0,
      cancelledRevenue: 0,
      manualRevenue: 0,
      dynamicRevenue: 0,
      walkInRevenue: 0,
      teamRevenue: 0,
      walkInNights: 0,
      teamNights: 0,
      manualNights: 0,
      dynamicNights: 0
    }
  };
  rooms.forEach(room => {
    (room.bookings || []).forEach(b => {
      const coversDate = dateStr >= b.checkInDate && dateStr < b.checkOutDate;
      if (!coversDate && b.status !== BookingStatus.CHECKED_OUT && b.status !== BookingStatus.CANCELLED) return;
      let nightRate = 0;
      if (coversDate) {
        const dayEntry = b.dailyBreakdown?.find(d => d.date === dateStr);
        nightRate = dayEntry ? dayEntry.rate : b.dailyRate;
      }
      const isTeam = !!(b.teamId || b.teamName);
      const entry = {
        bookingId: b.id,
        roomId: room.id,
        roomType: room.type,
        guestName: b.guestName,
        checkInDate: b.checkInDate,
        checkOutDate: b.checkOutDate,
        nightRate,
        priceSource: b.priceSource,
        teamId: b.teamId,
        teamName: b.teamName,
        isTeam,
        status: b.status
      };
      if (b.status === BookingStatus.CHECKED_IN && coversDate) {
        ledger.checkedIn.push(entry);
        ledger.totals.checkedInRevenue += nightRate;
        if (b.priceSource === PriceSource.MANUAL) { ledger.totals.manualRevenue += nightRate; ledger.totals.manualNights++; }
        else { ledger.totals.dynamicRevenue += nightRate; ledger.totals.dynamicNights++; }
        if (isTeam) { ledger.totals.teamRevenue += nightRate; ledger.totals.teamNights++; }
        else { ledger.totals.walkInRevenue += nightRate; ledger.totals.walkInNights++; }
      } else if (b.status === BookingStatus.RESERVED && coversDate) {
        ledger.reserved.push(entry);
        ledger.totals.reservedRevenue += nightRate;
        if (b.priceSource === PriceSource.MANUAL) { ledger.totals.manualRevenue += nightRate; ledger.totals.manualNights++; }
        else { ledger.totals.dynamicRevenue += nightRate; ledger.totals.dynamicNights++; }
        if (isTeam) { ledger.totals.teamRevenue += nightRate; ledger.totals.teamNights++; }
        else { ledger.totals.walkInRevenue += nightRate; ledger.totals.walkInNights++; }
      } else if (b.status === BookingStatus.CHECKED_OUT && b.checkOutActualDate === dateStr) {
        ledger.checkedOut.push({ ...entry, totalAmount: b.totalPrice });
        ledger.totals.checkedOutRevenue += b.totalPrice;
        if (b.priceSource === PriceSource.MANUAL) ledger.totals.manualRevenue += b.totalPrice;
        else ledger.totals.dynamicRevenue += b.totalPrice;
        if (isTeam) ledger.totals.teamRevenue += b.totalPrice;
        else ledger.totals.walkInRevenue += b.totalPrice;
      } else if (b.status === BookingStatus.CANCELLED && b.cancelledAt === dateStr) {
        ledger.cancelled.push({ ...entry, reason: b.cancellationReason });
        ledger.totals.cancelledRevenue += b.totalPrice;
      }
    });
  });
  return ledger;
}

function allocateTeam(teamId) {
  const teams = getTeams();
  const team = teams.find(t => t.id === teamId);
  if (!team) throw new Error('团队不存在');
  if (team.status === TeamStatus.ALLOCATED) {
    throw new Error('该团队已完成分房');
  }
  if (team.status === TeamStatus.CANCELLED) {
    throw new Error('该团队已取消');
  }
  const pendingCount = team.count - (team.allocatedCount || 0) - (team.cancelledCount || 0);
  if (pendingCount <= 0) throw new Error('没有待分房的订单');
  const bookingsToCreate = [{
    roomType: team.roomType,
    checkInDate: team.checkInDate,
    nights: team.nights,
    count: pendingCount,
    teamName: team.name,
    teamId: team.id
  }];
  const result = bulkBookTransactional(bookingsToCreate);
  if (!result.ok) {
    return { ok: false, errors: result.errors, allocatedCount: 0 };
  }
  const bookingIds = result.results.map(r => r.booking.id);
  team.allocatedCount = (team.allocatedCount || 0) + bookingIds.length;
  team.bookingIds = [...(team.bookingIds || []), ...bookingIds];
  if (team.allocatedCount >= team.count) {
    team.status = TeamStatus.ALLOCATED;
  } else {
    team.status = TeamStatus.PARTIAL;
  }
  saveTeams(teams);
  return { ok: true, success: bookingIds.length, allocated: bookingIds.length, allocatedCount: bookingIds.length, bookingIds, errors: [] };
}

function rescheduleTeam(teamId, newCheckInDate, newNights = null) {
  const teams = getTeams();
  const team = teams.find(t => t.id === teamId);
  if (!team) throw new Error('团队不存在');
  if (team.status === TeamStatus.CANCELLED) throw new Error('团队已取消');
  const finalNights = newNights || team.nights;
  const newCheckOutDate = addDays(newCheckInDate, finalNights);
  if (!team.bookingIds || team.bookingIds.length === 0) {
    team.checkInDate = newCheckInDate;
    team.checkOutDate = newCheckOutDate;
    team.nights = finalNights;
    saveTeams(teams);
    return { ok: true, movedCount: 0 };
  }
  const rooms = getRooms();
  const roomsSnapshot = JSON.parse(JSON.stringify(rooms));
  const oldBookings = [];
  team.bookingIds.forEach(bid => {
    rooms.forEach(room => {
      const b = (room.bookings || []).find(x => x.id === bid);
      if (b) oldBookings.push({ roomId: room.id, booking: { ...b } });
    });
  });
  try {
    oldBookings.forEach(({ roomId, booking }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) return;
      const idx = room.bookings.findIndex(x => x.id === booking.id);
      if (idx >= 0) room.bookings.splice(idx, 1);
    });
    saveRooms(rooms);
    const newBookings = [];
    for (let i = 0; i < oldBookings.length; i++) {
      const oldBk = oldBookings[i].booking;
      let room = findAvailableRoom(team.roomType, newCheckInDate, finalNights);
      if (!room) {
        const typedRooms = getRoomsByType(team.roomType);
        room = typedRooms[0];
      }
      if (!room) throw new Error('无可用房间');
      const r = reserveRoom(room.id, {
        guestName: oldBk.guestName,
        checkInDate: newCheckInDate,
        nights: finalNights,
        manualRate: oldBk.dailyRate,
        teamId: team.id,
        teamName: team.name
      });
      newBookings.push(r.booking);
    }
    team.checkInDate = newCheckInDate;
    team.checkOutDate = newCheckOutDate;
    team.nights = finalNights;
    team.bookingIds = newBookings.map(b => b.id);
    saveTeams(teams);
    return { ok: true, movedCount: newBookings.length, newCheckInDate, newCheckOutDate };
  } catch (e) {
    saveRooms(roomsSnapshot);
    return { ok: false, error: e.message, movedCount: 0 };
  }
}

function cancelAllTeamBookings(teamId, reason = '团队取消') {
  const teams = getTeams();
  const team = teams.find(t => t.id === teamId);
  if (!team) throw new Error('团队不存在');
  if (team.status === TeamStatus.CANCELLED) throw new Error('团队已取消');
  const rooms = getRooms();
  let cancelledCount = 0;
  const bookingIdsToCancel = [...(team.bookingIds || [])];
  bookingIdsToCancel.forEach(bid => {
    rooms.forEach(room => {
      const b = (room.bookings || []).find(x => x.id === bid);
      if (b && b.status !== BookingStatus.CHECKED_OUT && b.status !== BookingStatus.CANCELLED) {
        if (b.status === BookingStatus.CHECKED_IN) {
          return;
        }
        b.status = BookingStatus.CANCELLED;
        b.cancelledAt = getToday();
        b.cancellationReason = reason;
        team.cancelledCount = (team.cancelledCount || 0) + 1;
        team.bookingIds = (team.bookingIds || []).filter(id => id !== bid);
        cancelledCount++;
      }
    });
  });
  if (cancelledCount > 0 || team.status !== TeamStatus.PENDING) {
    team.allocatedCount = Math.max(0, (team.allocatedCount || 0) - cancelledCount);
    if ((team.cancelledCount || 0) >= team.count) {
      team.status = TeamStatus.CANCELLED;
    } else if ((team.allocatedCount || 0) === 0 && team.cancelledCount > 0) {
      team.status = TeamStatus.CANCELLED;
    }
  }
  if (team.status === TeamStatus.PENDING) {
    team.status = TeamStatus.CANCELLED;
  }
  saveRooms(rooms);
  saveTeams(teams);
  return { ok: true, cancelledCount, teamId };
}

function cancelTeamBooking(teamId, bookingId, reason = '') {
  const teams = getTeams();
  const team = teams.find(t => t.id === teamId);
  if (!team) throw new Error('团队不存在');
  const rooms = getRooms();
  let targetRoom = null;
  let targetBooking = null;
  rooms.forEach(room => {
    const b = (room.bookings || []).find(x => x.id === bookingId);
    if (b) { targetRoom = room; targetBooking = b; }
  });
  if (!targetBooking) throw new Error('预订不存在');
  if (targetBooking.status === BookingStatus.CHECKED_IN) {
    throw new Error('客人已在住，请先办理退房');
  }
  const result = cancelBooking(targetRoom.id, bookingId, reason);
  return { ok: true, room: result.room, booking: result.booking };
}

function getTeamBookings(teamId) {
  const rooms = getRooms();
  const bookings = [];
  rooms.forEach(room => {
    (room.bookings || []).forEach(b => {
      if (b.teamId === teamId) {
        bookings.push({
          ...b,
          roomId: room.id,
          roomNumber: room.number,
          roomType: room.type
        });
      }
    });
  });
  return bookings.sort((a, b) => {
    if (a.status !== b.status) {
      const order = { reserved: 0, checked_in: 1, checked_out: 2, cancelled: 3 };
      return order[a.status] - order[b.status];
    }
    return a.roomNumber - b.roomNumber;
  });
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
  bulkBookTransactional,
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
  getTeamBookings,
  countDatesInRange
};
