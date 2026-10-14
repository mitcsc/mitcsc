import { formatDay, localDate, TIME_ZONE } from "./config";

// An event's hours, which open and close check-in. Times are "HH:MM" on the event's date, in the club's time zone.
// An event without times takes the whole day, and its check-in stays open from then on. checkIn is an exec's choice, and it wins over the times.
export interface EventHours {
  date: string;
  starts?: string | null;
  ends?: string | null;
  checkIn?: "open" | "closed" | null;
}

// What the New event form needs to know about other events, to warn about overlaps.
export type TakenEvent = EventHours & { id: string; name: string };
export function takenEvent(e: TakenEvent): TakenEvent {
  return { id: e.id, name: e.name, date: e.date, starts: e.starts ?? null, ends: e.ends ?? null };
}

export const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// The date and "HH:MM" time now, in the club's time zone.
export function localNow(now: Date) {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  return { date: localDate(now), time };
}

// Two events clash when they are on the same day and their hours overlap. An event without times takes the whole day.
export function clashes(a: EventHours, b: EventHours) {
  if (a.date !== b.date) return false;
  if (!a.starts || !a.ends || !b.starts || !b.ends) return true;
  return a.starts < b.ends && b.starts < a.ends;
}

// "19:00" → "7:00 PM".
export function formatClock(time: string) {
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
export type CheckInState = { open: boolean; note: string; toggle: "Close check-in" | "Open check-in now" | "Reopen check-in" };

// Whether check-in is open now, and a short note for the check-in page.
export function checkInState(e: EventHours, now: Date): CheckInState {
  if (e.checkIn === "open") return { open: true, note: "Opened by an exec", toggle: "Close check-in" };
  if (e.checkIn === "closed") return { open: false, note: "Closed by an exec", toggle: "Reopen check-in" };
  const today = localNow(now);
  if (!e.starts || !e.ends) {
    return today.date < e.date ? { open: false, note: `Opens ${formatDay(e.date)}`, toggle: "Open check-in now" } : { open: true, note: "Stays open until someone closes it", toggle: "Close check-in" };
  }
  const day = e.date === today.date ? "" : `${formatDay(e.date)} at `;
  if (today.date < e.date || (today.date === e.date && today.time < e.starts)) return { open: false, note: `Opens ${day || "at "}${formatClock(e.starts)}`, toggle: "Open check-in now" };
  if (today.date === e.date && today.time < e.ends) return { open: true, note: `Closes at ${formatClock(e.ends)}`, toggle: "Close check-in" };
  return { open: false, note: `Closed ${day || "at "}${formatClock(e.ends)}`, toggle: "Reopen check-in" };
}

// When check-in opens on its own, as a timestamp: the start time, or midnight for an event without times.
export function opensAt(e: EventHours) {
  const [y, mo, d] = e.date.split("-").map(Number);
  const [h, mi] = (e.starts && e.ends ? e.starts : "00:00").split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Read as UTC, the wall time is off by the time zone's offset. The second pass settles a daylight saving change.
  let at = wall;
  for (let i = 0; i < 2; i++) at = wall - zoneOffset(at);
  return at;
}

// How far the club's wall clock is ahead of UTC at a moment, in ms (negative in Boston).
function zoneOffset(at: number) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute")) - Math.floor(at / 60_000) * 60_000;
}

// An event "starts soon" when its check-in opens on its own within this time.
export const SOON_MS = 24 * 60 * 60 * 1000;

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
  const relevant = events.filter((e) => e.date === today || soon(e) || (e.checkIn === "open" && e.date > today)).sort((a, b) => opensAt(a) - opensAt(b));
  return relevant.find((e) => checkInState(e, now).open) || relevant.find(soon) || relevant.at(-1) || null;
}
