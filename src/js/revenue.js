import {
  RoomTypes,
  RoomStatus,
  getRooms,
  getRevenueHistory,
  getToday,
  addDays
} from './state.js';

const TOTAL_ROOMS = 40;

function getTodayMetrics() {
  const today = getToday();
  const rooms = getRooms();
  const history = getRevenueHistory();
  const todayRecord = history.find(r => r.date === today);
  const occupiedRooms = rooms.filter(
    r => r.status !== RoomStatus.VACANT
  ).length;
  const checkedOutToday = todayRecord ? todayRecord.soldRooms : 0;
  const revenueToday = todayRecord ? todayRecord.revenue : 0;
  const currentRevenue = rooms.reduce((sum, r) => {
    if (r.status !== RoomStatus.VACANT) {
      return sum + (r.totalPrice || 0);
    }
    return sum;
  }, 0);
  const totalRevenue = revenueToday + currentRevenue;
  const soldRooms = checkedOutToday + occupiedRooms;
  const occupancy = TOTAL_ROOMS > 0 ? occupiedRooms / TOTAL_ROOMS : 0;
  const adr = soldRooms > 0 ? totalRevenue / soldRooms : 0;
  const revpar = TOTAL_ROOMS > 0 ? totalRevenue / TOTAL_ROOMS : 0;
  return {
    date: today,
    occupancy,
    adr: Math.round(adr),
    revpar: Math.round(revpar),
    revenue: totalRevenue,
    occupiedRooms,
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
      rooms.forEach(r => {
        if (r.type === type && r.status !== RoomStatus.VACANT && r.checkInDate && r.checkOutDate) {
          if (date >= r.checkInDate && date < r.checkOutDate) {
            count++;
          }
        }
      });
      heatmap[type].push({ date, count });
    }
  });
  return heatmap;
}

export {
  getTodayMetrics,
  getTrendData,
  getBookingHeatmap
};
