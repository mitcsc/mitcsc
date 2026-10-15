import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { formatStamp, formatTime, TIME_ZONE } from "./config";
import { publicMessage } from "./errors";
import { replaceTab } from "./google/sheets";
import { keys } from "./keys";
import { getJson, redis } from "./redis";
import { getEvent, getYear, listAttendance, listMembers } from "./store";
import type { Member, YearConfig } from "./types";

export interface SyncStatus {
  at: number;
  ok: boolean;
  error: string | null;
}

const METHOD = { venmo: "Venmo", zelle: "Zelle", cash: "Cash" } as const;

function stamp(ms: number) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: TIME_ZONE }).format(ms);
}

function memberRows(config: YearConfig, members: Member[]) {
  const extra = config.form.questions.filter((q) => !q.builtin);
  const header = ["Signed up", "Kerberos", "Name", "Class year", "Where they live", ...extra.map((q) => q.label), "Type", "Price", "Payment", "Status", "Paid on", "Confirmed by"];
  const rows = [...members].sort((a, b) => a.createdAt - b.createdAt).map((m) => [
    stamp(m.createdAt), m.kerb, m.name, m.classYear, m.dorm,
    ...extra.map((q) => { const v = m.answers[q.id]; return Array.isArray(v) ? v.join(", ") : v || ""; }),
    m.type === "returning" ? "Returning" : "New", m.price, METHOD[m.paidVia || m.method],
    m.status === "paid" ? "Paid" : "Not paid", m.paidAt ? stamp(m.paidAt) : "", m.confirmedBy || "",
  ]);
  return [header, ...rows];
}

async function syncMembers(year: string) {
  const config = await getYear(year);
  if (!config?.sheetId) return;
  await replaceTab(config.sheetId, "Members", memberRows(config, await listMembers(year)));
}

async function syncEvent(id: string) {
  const event = await getEvent(id);
  if (!event?.sheetId) return;
  const records = await listAttendance(id);
  await replaceTab(event.sheetId, event.sheetTab, [
    ["Time", "Name", "Kerberos", "Class year", "Payment", "Checked in by"],
    ...records.map((r) => [`${formatStamp(r.at)} ${formatTime(r.at)}`, r.name, r.kerb, r.classYear, r.paid ? "Paid" : "Not paid", r.by]),
  ]);
}

// Rewrites a Google Sheet from Redis. Only one run per sheet at a time; a change that
// lands during a run marks the sheet dirty so the running worker writes it again.
async function run(target: string, work: () => Promise<void>) {
  const lock = keys.sync(target);
  await redis("SET", `${lock}:dirty`, "1", "EX", 3600);
  for (let round = 0; round < 5; round++) {
    const owner = randomUUID();
    if ((await redis("SET", lock, owner, "NX", "PX", 60_000)) !== "OK") return;
    try {
      while (await redis<string | null>("GETDEL", `${lock}:dirty`)) {
        let status: SyncStatus;
        try {
          await work();
          status = { at: Date.now(), ok: true, error: null };
        } catch (error) {
          status = { at: Date.now(), ok: false, error: publicMessage(error, "Google Sheets could not be updated.") };
        }
        await redis("SET", `${lock}:status`, JSON.stringify(status));
      }
    } finally {
      await redis("EVAL", "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", 1, lock, owner);
    }
    if (!(await redis<number>("EXISTS", `${lock}:dirty`))) return;
  }
}

export function syncMembersLater(year: string) {
  after(() => run(`members:${year}`, () => syncMembers(year)).catch((e) => console.error(e)));
}

export function syncEventLater(id: string) {
  after(() => run(`event:${id}`, () => syncEvent(id)).catch((e) => console.error(e)));
}

export async function syncMembersNow(year: string) {
  await run(`members:${year}`, () => syncMembers(year));
}

export async function syncStatus(target: string) {
  return getJson<SyncStatus>(`${keys.sync(target)}:status`);
}
