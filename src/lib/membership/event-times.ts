import { formatDay, localDate, TIME_ZONE } from "./config";

// An event's hours, which open and close check-in. Times are "HH:MM" on the event's date, in the club's time zone.
// An event without times takes the whole day. checkIn is an exec's choice, and it wins over the times.
// Check-in never stays open for good: see OPEN_FOR_MS.
export interface EventHours {
  date: string;
  starts?: string | null;
  ends?: string | null;
  checkIn?: "open" | "closed" | null;
  // When an exec opened check-in by hand.
  checkInAt?: number | null;
  createdAt?: number;
}

// Check-in without an end time closes on its own this long after it opened:
// check-in an exec opened by hand, and an event without times that was made late on its day.
export const OPEN_FOR_MS = 12 * 60 * 60 * 1000;

// What the New event form needs to know about other events, to warn about overlaps.
export type TakenEvent = EventHours & { id: string; name: string };
export function takenEvent(e: TakenEvent): TakenEvent {
  return { id: e.id, name: e.name, date: e.date, starts: e.starts ?? null, ends: e.ends ?? null };
}

export const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const WALL = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });

// The date and "HH:MM" time now, in the club's time zone.
function localNow(now: Date) {
  return { date: localDate(now), time: CLOCK.format(now) };
}

// Two events clash when they are on the same day and their hours overlap. An event without times takes the whole day.
export function clashes(a: EventHours, b: EventHours) {
  if (a.date !== b.date) return false;
  if (!a.starts || !a.ends || !b.starts || !b.ends) return true;
  return a.starts < b.ends && b.starts < a.ends;
}

// "19:00" → "7:00 PM".
function formatClock(time: string) {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// "7:00 – 9:00 PM", or "11:00 AM – 1:00 PM". Null without times.
export function formatHours(e: EventHours) {
  if (!e.starts || !e.ends) return null;
  const [start, end] = [formatClock(e.starts), formatClock(e.ends)];
  const sameHalf = start.slice(-2) === end.slice(-2);
  return `${sameHalf ? start.slice(0, -3) : start} – ${end}`;
}

// Why a new event's hours are refused, naming the event they overlap.
export function clashNote(other: EventHours & { name: string }) {
  const hours = formatHours(other);
  const where = hours ? `is on ${formatDay(other.date)}, ${hours}` : `takes all of ${formatDay(other.date)} because it has no set times`;
  return `“${other.name}” ${where}. Events on the same day cannot overlap.`;
}

// toggle names the button that flips it: check-in that has not opened yet is opened, not reopened.
type CheckInState = { open: boolean; note: string; toggle: "Close check-in" | "Open check-in now" | "Reopen check-in" };

// "at 7:00 AM" for a moment today, or "Oct 14 at 7:00 AM".
function formatMoment(ms: number, today: string) {
  const at = localNow(new Date(ms));
  return `${at.date === today ? "" : `${formatDay(at.date)} `}at ${formatClock(at.time)}`;
}

// Whether check-in is open now, and a short note for the check-in page.
// Check-in an exec opened lasts OPEN_FOR_MS. After that, the event's times apply again.
// An event without times is open all day. One made late on its day stays open OPEN_FOR_MS after it was made.
export function checkInState(e: EventHours, now: Date): CheckInState {
  const ms = now.getTime();
  const today = localNow(now);
  const openedUntil = (e.checkInAt ?? 0) + OPEN_FOR_MS;
  if (e.checkIn === "open" && ms < openedUntil) return { open: true, note: `Opened by an exec, closes ${formatMoment(openedUntil, today.date)}`, toggle: "Close check-in" };
  if (e.checkIn === "closed") return { open: false, note: "Closed by an exec", toggle: "Reopen check-in" };
  if (!e.starts || !e.ends) {
    if (today.date < e.date) return { open: false, note: `Opens ${formatDay(e.date)}`, toggle: "Open check-in now" };
    const dayEnd = wallTime(nextDay(e.date), "00:00");
    const closes = Math.max(dayEnd, (e.createdAt ?? 0) + OPEN_FOR_MS);
    if (ms < closes) return { open: true, note: `Closes ${closes === dayEnd ? "at midnight" : formatMoment(closes, today.date)}`, toggle: "Close check-in" };
    return { open: false, note: `Closed ${closes === dayEnd ? `at the end of ${formatDay(e.date)}` : formatMoment(closes, today.date)}`, toggle: "Reopen check-in" };
  }
  const day = e.date === today.date ? "" : `${formatDay(e.date)} at `;
  if (today.date < e.date || (today.date === e.date && today.time < e.starts)) return { open: false, note: `Opens ${day || "at "}${formatClock(e.starts)}`, toggle: "Open check-in now" };
  if (today.date === e.date && today.time < e.ends) return { open: true, note: `Closes at ${formatClock(e.ends)}`, toggle: "Close check-in" };
  return { open: false, note: `Closed ${day || "at "}${formatClock(e.ends)}`, toggle: "Reopen check-in" };
}

// When check-in opens on its own, as a timestamp: the start time, or midnight for an event without times.
export function opensAt(e: EventHours) {
  return wallTime(e.date, e.starts && e.ends ? e.starts : "00:00");
}

// "2026-10-13" → "2026-10-14".
function nextDay(date: string) {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
}

// A date and "HH:MM" time in the club's time zone, as a timestamp.
function wallTime(date: string, time: string) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Read as UTC, the wall time is off by the time zone's offset. The second pass settles a daylight saving change.
  let at = wall;
  for (let i = 0; i < 2; i++) at = wall - zoneOffset(at);
  return at;
}

// How far the club's wall clock is ahead of UTC at a moment, in ms (negative in Boston).
function zoneOffset(at: number) {
  const parts = WALL.formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute")) - Math.floor(at / 60_000) * 60_000;
}

// An event "starts soon" when its check-in opens on its own within this time.
const SOON_MS = 24 * 60 * 60 * 1000;

export function startsSoon(e: EventHours, now: number) {
  const at = opensAt(e);
  return at > now && at - now <= SOON_MS;
}

// The time left, from ms: "18h 51m", "12m 30s" or "45s".
export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

// The event the Check In tab shows: one open now, else the next to open within a day, else today's latest.
// Only today's events, those opening within a day, and later ones an exec opened early count.
// So an old event left open does not take over the tab.
// Null means there is none, and the tab shows the New event form.
export function homeEvent<T extends EventHours>(events: T[], now: Date): T | null {
  const ms = now.getTime();
  const today = localDate(now);
  const soon = (e: T) => opensAt(e) > ms && opensAt(e) - ms <= SOON_MS;
  const relevant = events.filter((e) => e.date === today || soon(e) || (e.date > today && checkInState(e, now).open)).sort((a, b) => opensAt(a) - opensAt(b));
  return relevant.find((e) => checkInState(e, now).open) || relevant.find(soon) || relevant.at(-1) || null;
}
