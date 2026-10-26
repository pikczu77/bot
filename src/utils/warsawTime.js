// warsawTime.js — calendar days and weeks in Polish time (Europe/Warsaw), for things that reset
// at midnight: daily missions, the daily Wordle word, weekly missions (Monday 00:00).

export const TIME_ZONE = 'Europe/Warsaw';

const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const offsetFormat = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, timeZoneName: 'shortOffset' });
const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-10-26" — the Warsaw calendar day of `now`. */
export const dayKey = (now = Date.now()) => dateFormat.format(new Date(now));

const parseDay = (key) => {
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};
const formatDay = (utcMs) => new Date(utcMs).toISOString().slice(0, 10);

/** "2026-10-26" — the Monday that starts the Warsaw week of `now`. */
export function weekKey(now = Date.now()) {
  const day = parseDay(dayKey(now));
  const weekday = (new Date(day).getUTCDay() + 6) % 7; // Monday 0 ... Sunday 6
  return formatDay(day - weekday * DAY_MS);
}

/** Whole days from day key `from` to `to` (2026-10-25 -> 2026-10-26 = 1). */
export const daysBetween = (from, to) => Math.round((parseDay(to) - parseDay(from)) / DAY_MS);

// Minutes Warsaw is ahead of UTC at `utcMs` (60 in winter, 120 in summer).
function offsetMinutes(utcMs) {
  const name = offsetFormat.formatToParts(new Date(utcMs)).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+1';
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!match) return 0;
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] || 0));
}

/** UTC time of 00:00 Warsaw on day key `key`. */
export function midnightOf(key) {
  const utc = parseDay(key);
  return utc - offsetMinutes(utc - 60 * 60 * 1000) * 60 * 1000;
}

/** When the next Warsaw day starts. */
export const nextMidnight = (now = Date.now()) => midnightOf(formatDay(parseDay(dayKey(now)) + DAY_MS));

/** When the next Warsaw week (Monday 00:00) starts. */
export const nextWeekStart = (now = Date.now()) => midnightOf(formatDay(parseDay(weekKey(now)) + 7 * DAY_MS));

const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23' });
/** The hour (0-23) in Warsaw at `now`. */
export const warsawHour = (now = Date.now()) => Number(hourFormat.format(new Date(now))) % 24;
