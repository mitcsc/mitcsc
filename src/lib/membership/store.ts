import { randomUUID } from "node:crypto";
import { MembershipError } from "./errors";
import { keys } from "./keys";
import { getJson, getManyJson, pipeline, redis, updateJson } from "./redis";
import type { Attendance, EventInfo, Member, YearConfig } from "./types";

// School years

export async function currentYear(): Promise<YearConfig | null> {
  const year = await redis<string | null>("GET", keys.currentYear);
  return year ? getJson<YearConfig>(keys.year(year)) : null;
}

export async function requireCurrentYear() {
  const config = await currentYear();
  if (!config) throw new MembershipError("No school year is set up yet.", 404);
  return config;
}

export async function getYear(year: string) {
  return getJson<YearConfig>(keys.year(year));
}

export async function createYear(config: YearConfig) {
  const created = await redis<string | null>("SET", keys.year(config.year), JSON.stringify(config), "NX");
  if (created !== "OK") throw new MembershipError(`${config.year} already exists.`, 409);
  await pipeline([["SADD", keys.years, config.year], ["SET", keys.currentYear, config.year]]);
}

export async function updateYear(year: string, change: (config: YearConfig) => YearConfig) {
  const config = await updateJson<YearConfig>(keys.year(year), change);
  if (!config) throw new MembershipError(`${year} does not exist.`, 404);
  return config;
}

// Members

export async function getMember(year: string, kerb: string) {
  return getJson<Member>(keys.member(year, kerb));
}

// Claims the kerb for this year, in one request. Fails when someone already signed up with it.
// ZADD NX leaves an earlier signup's place in the list alone.
export async function claimMember(member: Member) {
  const [claimed] = await pipeline<[string | null, number]>([
    ["SET", keys.member(member.year, member.kerb), JSON.stringify(member), "NX"],
    ["ZADD", keys.members(member.year), "NX", member.createdAt, member.kerb],
  ]);
  return claimed === "OK";
}

export async function updateMember(year: string, kerb: string, change: (member: Member) => Member) {
  const member = await updateJson<Member>(keys.member(year, kerb), change);
  if (!member) throw new MembershipError(`${kerb} is not signed up for ${year}.`, 404);
  return member;
}

export async function deleteMember(year: string, kerb: string) {
  await pipeline([["DEL", keys.member(year, kerb)], ["DEL", keys.walletPass(year, kerb)], ["ZREM", keys.members(year), kerb]]);
}

// Newest first.
export async function listMembers(year: string) {
  const kerbs = await redis<string[]>("ZRANGE", keys.members(year), 0, -1, "REV");
  return (await getManyJson<Member>(kerbs.map((kerb) => keys.member(year, kerb)))).filter((m): m is Member => !!m);
}

export async function markPaidEver(kerbs: string[]) {
  for (let i = 0; i < kerbs.length; i += 500) await redis("SADD", keys.paidEver, ...kerbs.slice(i, i + 500));
}

export async function unmarkPaidEver(kerb: string) {
  await redis("SREM", keys.paidEver, kerb);
}

export async function hasPaidBefore(kerb: string) {
  const [paid, imported] = await pipeline<[number, number]>([["SISMEMBER", keys.paidEver, kerb], ["SISMEMBER", keys.pastImported, kerb]]);
  return paid === 1 || imported === 1;
}

export async function pastMemberCount() {
  return (await redis<string[]>("SUNION", keys.paidEver, keys.pastImported)).length;
}

// Events

// Events are sorted by their date, at midnight UTC.
function dayScore(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export async function createEvent(input: Omit<EventInfo, "id" | "createdAt">) {
  const event: EventInfo = { ...input, id: randomUUID().slice(0, 8), createdAt: Date.now() };
  await pipeline([
    ["SET", keys.event(event.id), JSON.stringify(event)],
    ["ZADD", keys.events(event.year), dayScore(event.date), event.id],
  ]);
  return event;
}

// The events on this date, earliest first. Events on the same day never overlap.
export async function eventsOn(year: string, date: string) {
  const score = dayScore(date);
  const ids = await redis<string[]>("ZRANGE", keys.events(year), score, score, "BYSCORE");
  const events = (await getManyJson<EventInfo>(ids.map(keys.event))).filter((e): e is EventInfo => !!e);
  return events.sort((a, b) => (a.starts || "").localeCompare(b.starts || ""));
}

export async function getEvent(id: string) {
  return /^[a-f0-9]{8}$/.test(id) ? getJson<EventInfo>(keys.event(id)) : null;
}

export async function updateEvent(id: string, change: (event: EventInfo) => EventInfo) {
  const event = await updateJson<EventInfo>(keys.event(id), change);
  if (!event) throw new MembershipError("This event does not exist.", 404);
  return event;
}

// Deletes the event and its check-ins. The caller handles its Google Sheet.
export async function deleteEvent(event: EventInfo) {
  const sync = keys.sync(`event:${event.id}`);
  await pipeline([
    ["ZREM", keys.events(event.year), event.id],
    ["DEL", keys.event(event.id), keys.attendance(event.id), sync, `${sync}:dirty`, `${sync}:status`],
  ]);
}

// Newest first. With a date, only the events on that date and later.
export async function eventsFrom(year: string, date?: string) {
  const ids = await redis<string[]>("ZRANGE", keys.events(year), "+inf", date ? dayScore(date) : "-inf", "BYSCORE", "REV");
  return (await getManyJson<EventInfo>(ids.map(keys.event))).filter((e): e is EventInfo => !!e);
}

// Newest first, with check-in counts.
export async function listEvents(year: string) {
  const events = await eventsFrom(year);
  const counts = await pipeline<number[]>(events.map((e) => ["HLEN", keys.attendance(e.id)]));
  return events.map((event, i) => ({ event, count: counts[i] }));
}

// Records a check-in once, in one request. Returns the earlier record when the person is already checked in,
// and the event's check-in count after it.
export async function checkIn(eventId: string, record: Attendance) {
  const key = keys.attendance(eventId);
  const [added, stored, count] = await pipeline<[number, string, number]>([
    ["HSETNX", key, record.kerb, JSON.stringify(record)], ["HGET", key, record.kerb], ["HLEN", key],
  ]);
  return added === 1 ? { added: true as const, record, count } : { added: false as const, record: JSON.parse(stored) as Attendance, count };
}

// Takes back a check-in, for example a tap on the wrong person. Returns false if they were not checked in.
export async function undoCheckIn(eventId: string, kerb: string) {
  return (await redis<number>("HDEL", keys.attendance(eventId), kerb)) === 1;
}

// A person's check-in, or null, and the event's check-in count, in one request.
export async function getAttendance(eventId: string, kerb: string) {
  const [raw, count] = await pipeline<[string | null, number]>([["HGET", keys.attendance(eventId), kerb], ["HLEN", keys.attendance(eventId)]]);
  return { record: raw ? (JSON.parse(raw) as Attendance) : null, count };
}

// Oldest first.
export async function listAttendance(eventId: string) {
  const flat = await redis<string[]>("HGETALL", keys.attendance(eventId));
  const records: Attendance[] = [];
  for (let i = 1; i < flat.length; i += 2) records.push(JSON.parse(flat[i]) as Attendance);
  return records.sort((a, b) => a.at - b.at);
}

export async function attendanceCount(eventId: string) {
  return redis<number>("HLEN", keys.attendance(eventId));
}
