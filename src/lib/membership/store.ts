import { randomUUID } from "node:crypto";
import { MembershipError } from "./errors";
import { keys } from "./keys";
import { getJson, getManyJson, pipeline, redis, updateJson } from "./redis";
import type { Attendance, EventInfo, Member, PastSheet, YearConfig } from "./types";

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

// Claims the kerb for this year. Fails when someone already signed up with it.
export async function claimMember(member: Member) {
  const claimed = await redis<string | null>("SET", keys.member(member.year, member.kerb), JSON.stringify(member), "NX");
  if (claimed !== "OK") return false;
  await redis("ZADD", keys.members(member.year), member.createdAt, member.kerb);
  return true;
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

// Splits the returning-price list into people from earlier years and this year's new members,
// who join the list when they pay but get the returning price only from next year.
export async function returningCounts(year: string) {
  const [all, imported] = await pipeline<[string[], string[]]>([["SUNION", keys.paidEver, keys.pastImported], ["SMEMBERS", keys.pastImported]]);
  const everyone = new Set(all);
  const fromSheets = new Set(imported);
  const thisYear = (await listMembers(year)).filter((m) => m.status === "paid" && m.type === "new" && everyone.has(m.kerb) && !fromSheets.has(m.kerb)).length;
  return { earlier: everyone.size - thisYear, thisYear };
}

// Past members from old sheets. Each sheet keeps its own kerbs, so removing one sheet
// keeps people who are also on another sheet or who paid on this site.

async function rebuildPastImported() {
  const ids = await redis<string[]>("HKEYS", keys.pastSheets);
  if (ids.length) await redis("SUNIONSTORE", keys.pastImported, ...ids.map(keys.pastSheet));
  else await redis("DEL", keys.pastImported);
}

// Importing a sheet again replaces its kerbs.
export async function savePastSheet(sheet: PastSheet, kerbs: string[]) {
  const commands: (string | number)[][] = [["DEL", keys.pastSheet(sheet.id)]];
  for (let i = 0; i < kerbs.length; i += 500) commands.push(["SADD", keys.pastSheet(sheet.id), ...kerbs.slice(i, i + 500)]);
  commands.push(["HSET", keys.pastSheets, sheet.id, JSON.stringify(sheet)]);
  await pipeline(commands);
  await rebuildPastImported();
}

export async function removePastSheet(id: string) {
  await pipeline([["DEL", keys.pastSheet(id)], ["HDEL", keys.pastSheets, id]]);
  await rebuildPastImported();
}

export async function listPastSheets() {
  await moveEarlierImports();
  const flat = await redis<string[]>("HGETALL", keys.pastSheets);
  const sheets: PastSheet[] = [];
  for (let i = 1; i < flat.length; i += 2) sheets.push(JSON.parse(flat[i]) as PastSheet);
  return sheets.sort((a, b) => b.importedAt - a.importedAt);
}

// Sheets imported before sheets were tracked put their kerbs straight into paid-ever.
// Runs once: kerbs with no paid signup on this site move to an "Earlier imports" entry that exec can remove.
async function moveEarlierImports() {
  if ((await redis<string | null>("SET", keys.pastMoved, String(Date.now()), "NX")) !== "OK") return;
  const years = await redis<string[]>("SMEMBERS", keys.years);
  const paidHere = new Set<string>();
  for (const year of years) for (const m of await listMembers(year)) if (m.status === "paid") paidHere.add(m.kerb);
  const earlier = (await redis<string[]>("SMEMBERS", keys.paidEver)).filter((kerb) => !paidHere.has(kerb));
  if (!earlier.length) return;
  await savePastSheet({ id: "earlier", name: "Earlier imports", count: earlier.length, importedAt: 0, importedBy: null }, earlier);
  for (let i = 0; i < earlier.length; i += 500) await redis("SREM", keys.paidEver, ...earlier.slice(i, i + 500));
}

// Events

export async function createEvent(input: Omit<EventInfo, "id" | "createdAt">) {
  const event: EventInfo = { ...input, id: randomUUID().slice(0, 8), createdAt: Date.now() };
  const [y, m, d] = event.date.split("-").map(Number);
  await pipeline([
    ["SET", keys.event(event.id), JSON.stringify(event)],
    ["ZADD", keys.events(event.year), Date.UTC(y, m - 1, d), event.id],
  ]);
  return event;
}

export async function getEvent(id: string) {
  return /^[a-f0-9]{8}$/.test(id) ? getJson<EventInfo>(keys.event(id)) : null;
}

export async function updateEvent(id: string, change: (event: EventInfo) => EventInfo) {
  const event = await updateJson<EventInfo>(keys.event(id), change);
  if (!event) throw new MembershipError("This event does not exist.", 404);
  return event;
}

// Newest first, with check-in counts.
export async function listEvents(year: string) {
  const ids = await redis<string[]>("ZRANGE", keys.events(year), 0, -1, "REV");
  const events = (await getManyJson<EventInfo>(ids.map(keys.event))).filter((e): e is EventInfo => !!e);
  const counts = await pipeline<number[]>(events.map((e) => ["HLEN", keys.attendance(e.id)]));
  return events.map((event, i) => ({ event, count: counts[i] }));
}

// Records a check-in once. Returns the earlier record when the person is already checked in.
export async function checkIn(eventId: string, record: Attendance) {
  const added = await redis<number>("HSETNX", keys.attendance(eventId), record.kerb, JSON.stringify(record));
  if (added === 1) return { added: true as const, record };
  const earlier = await redis<string>("HGET", keys.attendance(eventId), record.kerb);
  return { added: false as const, record: JSON.parse(earlier) as Attendance };
}

export async function getAttendance(eventId: string, kerb: string) {
  const raw = await redis<string | null>("HGET", keys.attendance(eventId), kerb);
  return raw ? (JSON.parse(raw) as Attendance) : null;
}

export async function updateAttendance(eventId: string, kerb: string, change: (record: Attendance) => Attendance) {
  const raw = await redis<string | null>("HGET", keys.attendance(eventId), kerb);
  if (!raw) return;
  await redis("HSET", keys.attendance(eventId), kerb, JSON.stringify(change(JSON.parse(raw) as Attendance)));
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
