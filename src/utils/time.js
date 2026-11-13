import { DateTime, IANAZone } from "luxon";

// All calendar maths happens here. A "localDate" is "YYYY-MM-DD" and a "month" is "YYYY-MM" in a given IANA zone.

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

export function isValidZone(tzid) {
  return typeof tzid === "string" && IANAZone.isValidZone(tzid);
}

const inSupportedYears = (value) =>
  Number(value.slice(0, 4)) >= 1970 && Number(value.slice(0, 4)) <= 2100;

export function isValidLocalDate(value) {
  return (
    LOCAL_DATE.test(value) &&
    inSupportedYears(value) &&
    DateTime.fromISO(value, { zone: "utc" }).isValid
  );
}

export function isValidMonth(value) {
  return (
    MONTH.test(value) &&
    inSupportedYears(value) &&
    DateTime.fromISO(`${value}-01`, { zone: "utc" }).isValid
  );
}

// The calendar day an instant falls on in the zone it was recorded in (never the viewer's zone).
export function localDateOf(instant, tzid) {
  return DateTime.fromJSDate(instant, { zone: tzid }).toISODate();
}

export function localMonthOf(instant, tzid) {
  return DateTime.fromJSDate(instant, { zone: tzid }).toFormat("yyyy-LL");
}

export function localTimeOf(instant, tzid) {
  return DateTime.fromJSDate(instant, { zone: tzid }).toFormat("HH:mm");
}

export function todayIn(tzid) {
  return DateTime.now().setZone(tzid).toISODate();
}

export function currentMonthIn(tzid) {
  return DateTime.now().setZone(tzid).toFormat("yyyy-LL");
}

// The instant for a wall-clock time on a local date in a zone (DST gaps resolve forward, as luxon does).
export function instantAt(localDate, localTime, tzid) {
  return DateTime.fromISO(`${localDate}T${localTime}`, { zone: tzid }).toJSDate();
}

export function addDays(localDate, days) {
  return DateTime.fromISO(localDate, { zone: "utc" }).plus({ days }).toISODate();
}

// Adds months keeping the original day-of-month, clamped to the end of shorter months (31 Jan + 1 → 28/29 Feb).
export function addMonthsClamped(localDate, months, anchorDay = Number(localDate.slice(8, 10))) {
  const base = DateTime.fromISO(localDate, { zone: "utc" }).startOf("month").plus({ months });
  return base.set({ day: Math.min(anchorDay, base.daysInMonth) }).toISODate();
}

export function addMonthsToMonth(month, months) {
  return DateTime.fromISO(`${month}-01`, { zone: "utc" }).plus({ months }).toFormat("yyyy-LL");
}

export function monthRange(month) {
  const start = DateTime.fromISO(`${month}-01`, { zone: "utc" });
  return { from: start.toISODate(), to: start.endOf("month").toISODate() };
}

export function daysOfMonth(month) {
  const { from, to } = monthRange(month);
  const days = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

// Week containing ref, starting on Monday ("mon") or Sunday ("sun").
export function weekRange(ref, weekStart) {
  const date = DateTime.fromISO(ref, { zone: "utc" });
  const startWeekday = weekStart === "sun" ? 7 : 1;
  const offset = (date.weekday - startWeekday + 7) % 7;
  const from = date.minus({ days: offset });
  return { from: from.toISODate(), to: from.plus({ days: 6 }).toISODate() };
}

export function yearRange(ref) {
  const year = ref.slice(0, 4);
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

// Period containing ref plus the period just before it (used for "vs previous period").
export function periodRanges(period, ref, weekStart) {
  if (period === "week") {
    const current = weekRange(ref, weekStart);
    return { current, previous: weekRange(addDays(current.from, -7), weekStart) };
  }
  if (period === "year") {
    const current = yearRange(ref);
    const previousYear = String(Number(ref.slice(0, 4)) - 1);
    return { current, previous: yearRange(`${previousYear}-01-01`) };
  }
  const month = ref.slice(0, 7);
  return { current: monthRange(month), previous: monthRange(addMonthsToMonth(month, -1)) };
}

// Next occurrence date of a repeat rule after `from` (a localDate), keeping the anchor day for monthly/yearly rules.
export function nextOccurrenceDate(from, { freq, interval, anchorDay, anchorMonth }) {
  if (freq === "daily") return addDays(from, interval);
  if (freq === "weekly") return addDays(from, 7 * interval);
  if (freq === "monthly") return addMonthsClamped(from, interval, anchorDay);
  const next = DateTime.fromISO(from, { zone: "utc" })
    .startOf("year")
    .plus({ years: interval })
    .set({ month: anchorMonth });
  return next.set({ day: Math.min(anchorDay, next.daysInMonth) }).toISODate();
}
