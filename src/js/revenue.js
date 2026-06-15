import {
  RoomTypes,
  BookingStatus,
  PriceSource,
  getRooms,
  getRevenueHistory,
  getToday,
  addDays
} from './state.js';

import { getRevenueLedger } from './rooms.js';

const TOTAL_ROOMS = 40;
const ROOMS_PER_TYPE = 10;

function getTodayMetrics() {
  const today = getToday();
  const rooms = getRooms();
  const history = getRevenueHistory();
  const todayRecord = history.find(r => r.date === today);

  let occupiedToday = 0;
  rooms.forEach(room => {
    (room.bookings || []).forEach(b => {
      if (b.status !== BookingStatus.CHECKED_IN) return;
      if (today >= b.checkInDate && today < b.checkOutDate) {
        occupiedToday++;
      }
    });
  });

  const checkedOutRevenue = todayRecord ? todayRecord.revenue : 0;
  const checkedOutSoldRooms = todayRecord ? todayRecord.soldRooms : 0;

  const occupancy = TOTAL_ROOMS > 0 ? occupiedToday / TOTAL_ROOMS : 0;
  const adr = checkedOutSoldRooms > 0 ? checkedOutRevenue / checkedOutSoldRooms : 0;
  const revpar = TOTAL_ROOMS > 0 ? checkedOutRevenue / TOTAL_ROOMS : 0;

  return {
    date: today,
    occupancy,
    adr: Math.round(adr),
    revpar: Math.round(revpar),
    revenue: checkedOutRevenue,
    occupiedRooms: occupiedToday,
    checkedOutRooms: checkedOutSoldRooms,
    totalRooms: TOTAL_ROOMS
  };
}

function getTrendData(days = 30) {
  const history = getRevenueHistory().slice(-days);
  return history.map(h => {
    const occupancy = TOTAL_ROOMS > 0 ? h.occupiedRooms / TOTAL_ROOMS : 0;
    const adr = h.soldRooms > 0 ? h.revenue / h.soldRooms : 0;
    const revpar = TOTAL_ROOMS > 0 ? h.revenue / TOTAL_ROOMS : 0;
    return {
      date: h.date,
      revenue: h.revenue,
      occupancy,
      adr: Math.round(adr),
      revpar: Math.round(revpar),
      occupiedRooms: h.occupiedRooms,
      soldRooms: h.soldRooms
    };
  });
}

function getBookingHeatmap(days = 7) {
  const today = getToday();
  const rooms = getRooms();
  const heatmap = {};
  Object.values(RoomTypes).forEach(type => {
    heatmap[type] = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(today, i);
      let count = 0;
      let overbook = 0;
      rooms.forEach(r => {
        if (r.type !== type) return;
        (r.bookings || []).forEach(b => {
          if (b.status === BookingStatus.CHECKED_OUT) return;
          if (date >= b.checkInDate && date < b.checkOutDate) {
            count++;
            if (b.isOverbook) overbook++;
          }
        });
      });
      heatmap[type].push({ date, count, overbook, normal: count - overbook });
    }
  });
  return heatmap;
}

function getRevenueBreakdown(days = 7) {
  const today = getToday();
  const result = [];
  const aggregate = {
    totalRevenue: 0,
    totalRecognized: 0,
    totalPending: 0,
    totalCancelled: 0,
    walkInRevenue: 0,
    teamRevenue: 0,
    manualRevenue: 0,
    dynamicRevenue: 0,
    walkInNights: 0,
    teamNights: 0,
    manualNights: 0,
    dynamicNights: 0,
    byDate: []
  };
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const ledger = getRevenueLedger(date);
    const recognized = ledger.totals.checkedOutRevenue;
    const recognizedCount = ledger.checkedOut.length;
    const pending = ledger.totals.checkedInRevenue + ledger.totals.reservedRevenue;
    const pendingCount = ledger.checkedIn.length + ledger.reserved.length;
    const cancelled = ledger.totals.cancelledRevenue;
    const cancelledCount = ledger.cancelled.length;

    aggregate.totalRevenue += recognized + pending;
    aggregate.totalRecognized += recognized;
    aggregate.totalPending += pending;
    aggregate.totalCancelled += cancelled;
    aggregate.walkInRevenue += ledger.totals.walkInRevenue;
    aggregate.teamRevenue += ledger.totals.teamRevenue;
    aggregate.manualRevenue += ledger.totals.manualRevenue;
    aggregate.dynamicRevenue += ledger.totals.dynamicRevenue;
    aggregate.walkInNights += ledger.totals.walkInNights;
    aggregate.teamNights += ledger.totals.teamNights;
    aggregate.manualNights += ledger.totals.manualNights;
    aggregate.dynamicNights += ledger.totals.dynamicNights;

    const dateEntry = {
      date,
      recognized,
      recognizedCount,
      pending,
      pendingCount,
      cancelled,
      cancelledCount,
      total: recognized + pending,
      totalCount: recognizedCount + pendingCount,
      bySource: {
        dynamic: ledger.totals.dynamicRevenue,
        manual: ledger.totals.manualRevenue
      },
      byCustomer: {
        walkIn: ledger.totals.walkInRevenue,
        team: ledger.totals.teamRevenue
      },
      byNights: {
        walkIn: ledger.totals.walkInNights,
        team: ledger.totals.teamNights,
        manual: ledger.totals.manualNights,
        dynamic: ledger.totals.dynamicNights
      }
    };
    aggregate.byDate.push(dateEntry);
    result.push(dateEntry);
  }
  return { days: result, aggregate };
}

export {
  getTodayMetrics,
  getTrendData,
  getBookingHeatmap,
  getRevenueBreakdown,
  getRevenueLedger
};
