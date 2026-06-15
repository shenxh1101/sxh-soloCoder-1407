import {
  getPricing,
  getToday,
  diffDays,
  addDays,
  RoomTypes
} from './state.js';

function isPeakSeason(dateStr, peakSeasons) {
  const target = new Date(dateStr);
  for (const season of peakSeasons) {
    const start = new Date(season.startDate);
    const end = new Date(season.endDate);
    if (target >= start && target <= end) {
      return season.multiplier;
    }
  }
  return 1;
}

function getAdvanceDiscount(bookingDate, checkInDate, discounts) {
  const daysAhead = diffDays(bookingDate, checkInDate);
  let bestRate = 1;
  for (const d of discounts) {
    if (daysAhead >= d.daysAhead && d.discountRate < bestRate) {
      bestRate = d.discountRate;
    }
  }
  return bestRate;
}

function calculateDailyRate(roomType, dateStr, options = {}) {
  const pricing = getPricing();
  const bookingDate = options.bookingDate || getToday();
  const base = pricing.basePrices[roomType] || 0;
  const peakMult = isPeakSeason(dateStr, pricing.peakSeasons);
  const advDiscount = getAdvanceDiscount(bookingDate, dateStr, pricing.advanceDiscounts);
  return Math.round(base * peakMult * advDiscount);
}

function calculateStayTotal(roomType, checkInDate, nights, options = {}) {
  const dailyBreakdown = [];
  let total = 0;
  for (let i = 0; i < nights; i++) {
    const date = addDays(checkInDate, i);
    const rate = calculateDailyRate(roomType, date, options);
    dailyBreakdown.push({ date, rate });
    total += rate;
  }
  return { total, dailyBreakdown };
}

function getPriceInfo(roomType, checkInDate, nights) {
  const pricing = getPricing();
  const today = getToday();
  const { total, dailyBreakdown } = calculateStayTotal(roomType, checkInDate, nights, { bookingDate: today });
  const baseTotal = pricing.basePrices[roomType] * nights;
  const peakInfo = [];
  dailyBreakdown.forEach(d => {
    const mult = isPeakSeason(d.date, pricing.peakSeasons);
    if (mult > 1) peakInfo.push({ date: d.date, multiplier: mult });
  });
  const discount = getAdvanceDiscount(today, checkInDate, pricing.advanceDiscounts);
  return {
    basePrice: pricing.basePrices[roomType],
    dailyBreakdown,
    total,
    baseTotal,
    discount,
    peakInfo,
    savings: baseTotal - total
  };
}

export {
  isPeakSeason,
  getAdvanceDiscount,
  calculateDailyRate,
  calculateStayTotal,
  getPriceInfo
};
