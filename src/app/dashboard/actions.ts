"use server";

import { canStartNextYear, formatDay, isKerb, isSchoolYear, newYearConfig, nextYearOpens, normalizeKerb, TIME_ZONE } from "@/lib/membership/config";
import { MembershipError } from "@/lib/membership/errors";
import { execAccess, requireExec } from "@/lib/membership/exec-auth";
import { clubFolder, clubPath, createFolder, getItem, listChildren, FOLDER, SPREADSHEET } from "@/lib/membership/google/drive";
import { clubEmail } from "@/lib/membership/google/oauth";
import { addTab, createSheet, readFirstTab } from "@/lib/membership/google/sheets";
import { cleanForm, text } from "@/lib/membership/form";
import { attempt, type Result } from "@/lib/membership/result";
import { readCardToken } from "@/lib/membership/signing";
import {
  attendanceCount, checkIn, claimMember, createEvent, getAttendance, createYear, currentYear, deleteMember, getEvent, getMember, getYear, hasPaidBefore, markPaidEver,
  removePastSheet, requireCurrentYear, savePastSheet, unmarkPaidEver, updateEvent, updateMember, updateYear,
} from "@/lib/membership/store";
import { syncEventLater, syncMembersLater, syncMembersNow } from "@/lib/membership/sync";
import type { Attendance, FormConfig, Member, PaymentMethod, YearConfig } from "@/lib/membership/types";
import { checkVenmo } from "@/lib/membership/venmo";
import { revokePass } from "@/lib/membership/wallet";

const METHODS: PaymentMethod[] = ["venmo", "zelle", "cash"];

// Settings

export type SettingsPatch = Partial<Pick<YearConfig, "signupsOpen" | "closesOn" | "walletExpiresOn" | "prices" | "venmo" | "zelle" | "cashAllowed">>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function price(value: unknown, label: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 500) throw new MembershipError(`Enter a ${label} price between $0 and $500.`);
  return Math.round(amount * 100) / 100;
}

export async function updateSettings(patch: SettingsPatch): Promise<Result<YearConfig>> {
  return attempt(async () => {
    await requireExec();
    const config = await requireCurrentYear();
    const clean: SettingsPatch = {};
    if (patch.signupsOpen !== undefined) clean.signupsOpen = !!patch.signupsOpen;
    if (patch.closesOn !== undefined) {
      if (patch.closesOn !== null && !ISO_DATE.test(patch.closesOn)) throw new MembershipError("Pick a closing date.");
      clean.closesOn = patch.closesOn || null;
    }
    if (patch.walletExpiresOn !== undefined) {
      if (!ISO_DATE.test(patch.walletExpiresOn)) throw new MembershipError("Pick the date Wallet cards expire.");
      clean.walletExpiresOn = patch.walletExpiresOn;
    }
    if (patch.prices) clean.prices = { new: price(patch.prices.new, "new member"), returning: price(patch.prices.returning, "returning member") };
    if (patch.venmo !== undefined) {
      const handle = String(patch.venmo).trim().replace(/^@/, "");
      if (!/^[A-Za-z0-9_-]{5,30}$/.test(handle)) throw new MembershipError("Enter the Venmo username, like @xiong-mao.");
      clean.venmo = handle;
    }
    if (patch.zelle !== undefined) clean.zelle = String(patch.zelle).trim().slice(0, 100);
    if (patch.cashAllowed !== undefined) clean.cashAllowed = !!patch.cashAllowed;
    return updateYear(config.year, (c) => ({ ...c, ...clean }));
  });
}

export async function saveForm(form: FormConfig): Promise<Result<FormConfig>> {
  return attempt(async () => {
    await requireExec();
    const config = await requireCurrentYear();
    const updated = await updateYear(config.year, (c) => ({ ...c, form: cleanForm(form, c.form) }));
    // New questions are new columns in the sheet.
    syncMembersLater(config.year);
    return updated.form;
  });
}

// Members

async function setPaid(config: YearConfig, kerb: string, method: PaymentMethod, by: string) {
  if (!METHODS.includes(method)) throw new MembershipError("Pick how they paid.");
  const member = await updateMember(config.year, kerb, (m) => (m.status === "paid" ? m : {
    ...m, status: "paid", method, paidVia: method, paidAt: Date.now(), confirmedBy: by,
  }));
  await markPaidEver([kerb]);
  syncMembersLater(config.year);
  return member;
}

export async function confirmPayment(kerb: string, method: PaymentMethod): Promise<Result<Member>> {
  return attempt(async () => {
    const by = await requireExec();
    return setPaid(await requireCurrentYear(), kerb, method, by);
  });
}

export async function markUnpaid(kerb: string): Promise<Result<Member>> {
  return attempt(async () => {
    await requireExec();
    const config = await requireCurrentYear();
    const member = await updateMember(config.year, kerb, (m) => ({ ...m, status: "unpaid", paidVia: null, paidAt: null, confirmedBy: null, venmoMessageId: null }));
    // A new member who never paid must not get the returning price next year.
    if (member.type === "new") await unmarkPaidEver(kerb);
    syncMembersLater(config.year);
    return member;
  });
}

export async function removeSignup(kerb: string): Promise<Result<null>> {
  return attempt(async () => {
    await requireExec();
    const config = await requireCurrentYear();
    const member = await getMember(config.year, kerb);
    if (!member) return null;
    if (member.wallet) await revokePass(member.wallet.serial).catch(() => undefined);
    await deleteMember(config.year, kerb);
    if (member.type === "new" && member.status === "paid") await unmarkPaidEver(kerb);
    syncMembersLater(config.year);
    return null;
  });
}

export async function checkVenmoNow(): Promise<Result<{ confirmed: string[] }>> {
  return attempt(async () => {
    await requireExec();
    const result = await checkVenmo(await requireCurrentYear(), { minGapSeconds: 5 });
    if (!result.ran) throw new MembershipError("Venmo was checked a few seconds ago. Try again in a moment.", 429);
    if (result.confirmed.length) syncMembersLater((await requireCurrentYear()).year);
    return { confirmed: result.confirmed };
  });
}

export async function syncSheetNow(): Promise<Result<null>> {
  return attempt(async () => {
    await requireExec();
    await syncMembersNow((await requireCurrentYear()).year);
    return null;
  });
}

// Google Drive

export interface DriveListing {
  path: { id: string; name: string }[];
  items: { id: string; name: string; kind: "folder" | "sheet" }[];
}

// The picker only sees the club folder and what is inside it. An empty id means the club folder.
export async function browseDrive(folderId: string, includeSheets: boolean): Promise<Result<DriveListing>> {
  return attempt(async () => {
    await requireExec();
    const root = await clubFolder();
    const path = await clubPath(folderId || root.id, root);
    const children = await listChildren(path.at(-1)!.id, includeSheets);
    return {
      path,
      items: children.map((c) => ({ id: c.id, name: c.name, kind: c.mimeType === FOLDER ? "folder" as const : "sheet" as const })),
    };
  });
}

export async function makeFolder(name: string, parentId: string): Promise<Result<{ id: string; name: string }>> {
  return attempt(async () => {
    await requireExec();
    const clean = text(name, 100);
    if (!clean) throw new MembershipError("Name the folder.");
    const root = await clubFolder();
    const parent = (await clubPath(parentId || root.id, root)).at(-1)!;
    const folder = await createFolder(clean, parent.id);
    return { id: folder.id, name: folder.name };
  });
}

// New school year: the membership sheet goes straight into the folder exec pick.
export async function createSchoolYear(input: { year: string; folderId: string; sheetName: string; prices: { new: number; returning: number } }): Promise<Result<string>> {
  return attempt(async () => {
    const by = await requireExec();
    if (!isSchoolYear(input.year)) throw new MembershipError("Pick a school year like 2027-2028.");
    if (await getYear(input.year)) throw new MembershipError(`${input.year} already exists.`, 409);
    const previous = await currentYear();
    if (previous && !canStartNextYear(previous.year)) {
      throw new MembershipError(`You can start the next school year from ${formatDay(nextYearOpens(previous.year), true)}.`);
    }
    const sheetName = text(input.sheetName, 100) || `CSC ${input.year} Membership`;
    if (!input.folderId) throw new MembershipError("Pick the folder for the membership sheet.");
    await clubPath(input.folderId);
    const folder = await getItem(input.folderId);
    if (folder.mimeType !== FOLDER) throw new MembershipError("Pick the folder for the membership sheet.");
    const sheetId = await createSheet(sheetName, folder.id, "Members", clubEmail());
    const config: YearConfig = {
      ...newYearConfig(input.year, previous),
      prices: { new: price(input.prices.new, "new member"), returning: price(input.prices.returning, "returning member") },
      folderId: folder.id,
      sheetId,
      sheetName,
    };
    await createYear(config);
    syncMembersLater(config.year);
    console.info(`Membership year ${config.year} created by ${by}`);
    return config.year;
  });
}

// Events

export async function createEventAction(input: { name: string; date: string; folderId: string | null; sheetId: string | null }): Promise<Result<string>> {
  return attempt(async () => {
    const by = await requireExec();
    const config = await requireCurrentYear();
    const name = text(input.name, 100);
    if (!name) throw new MembershipError("Name the event.");
    if (!ISO_DATE.test(input.date)) throw new MembershipError("Pick the event date.");
    let sheetId: string | null = null;
    let sheetTab = "Attendance";
    if (input.sheetId) {
      await clubPath(input.sheetId);
      const sheet = await getItem(input.sheetId);
      if (sheet.mimeType !== SPREADSHEET) throw new MembershipError("Pick a Google Sheet.");
      sheetTab = await addTab(sheet.id, name.slice(0, 90), clubEmail());
      sheetId = sheet.id;
    } else if (input.folderId || config.eventsFolderId || config.folderId) {
      const folderId = input.folderId || config.eventsFolderId || config.folderId!;
      await clubPath(folderId);
      sheetId = await createSheet(name, folderId, sheetTab, clubEmail());
      // The next event starts in the same folder.
      if (folderId !== config.eventsFolderId) await updateYear(config.year, (c) => ({ ...c, eventsFolderId: folderId }));
    }
    const event = await createEvent({ year: config.year, name, date: input.date, sheetId, sheetTab, createdBy: by });
    syncEventLater(event.id);
    return event.id;
  });
}

export async function renameEvent(id: string, name: string): Promise<Result<null>> {
  return attempt(async () => {
    await requireExec();
    const clean = text(name, 100);
    if (!clean) throw new MembershipError("Name the event.");
    await updateEvent(id, (e) => ({ ...e, name: clean }));
    return null;
  });
}

export interface Person {
  kerb: string;
  name: string;
  classYear: string;
  price: number;
  method: PaymentMethod;
  paid: boolean;
  reportedAt: number | null;
}

export type CheckInResult =
  | { kind: "checked-in" | "already"; person: Person; record: Attendance; count: number }
  | { kind: "unpaid"; person: Person; count: number }
  | { kind: "unknown"; message: string };

function person(m: Member): Person {
  return { kerb: m.kerb, name: m.name, classYear: m.classYear, price: m.price, method: m.method, paid: m.status === "paid", reportedAt: m.reportedAt };
}

// "check-in" stops at unpaid members; "confirm" marks them paid first; "anyway" lets them in unpaid.
async function admit(eventId: string, kerb: string, mode: "check-in" | "confirm" | "anyway", by: string): Promise<CheckInResult> {
  const event = await getEvent(eventId);
  if (!event) throw new MembershipError("This event does not exist.", 404);
  const config = await getYear(event.year);
  let member = await getMember(event.year, kerb);
  if (!config || !member) return { kind: "unknown", message: `${kerb} is not signed up for ${event.year}.` };
  if (member.status !== "paid" && mode === "confirm") member = await setPaid(config, kerb, member.method, by);
  if (member.status !== "paid" && mode === "check-in") {
    const earlier = await getAttendance(eventId, kerb);
    const count = await attendanceCount(eventId);
    return earlier ? { kind: "already", person: person(member), record: earlier, count } : { kind: "unpaid", person: person(member), count };
  }
  const result = await checkIn(eventId, { kerb, name: member.name, classYear: member.classYear, paid: member.status === "paid", at: Date.now(), by });
  if (result.added) syncEventLater(eventId);
  return { kind: result.added ? "checked-in" : "already", person: person(member), record: result.record, count: await attendanceCount(eventId) };
}

export async function checkInPerson(eventId: string, kerb: string, mode: "check-in" | "confirm" | "anyway"): Promise<Result<CheckInResult>> {
  return attempt(async () => {
    const by = await requireExec();
    const clean = normalizeKerb(kerb);
    if (!isKerb(clean)) throw new MembershipError("That is not a kerb.");
    return admit(eventId, clean, mode, by);
  });
}

export async function scanCard(eventId: string, value: string): Promise<Result<CheckInResult>> {
  return attempt(async () => {
    const by = await requireExec();
    const card = readCardToken(value);
    if (!card) return { kind: "unknown", message: "That QR code is not a CSC membership card." };
    const event = await getEvent(eventId);
    if (!event) throw new MembershipError("This event does not exist.", 404);
    if (!event.year.startsWith(`${card.startYear}-`)) return { kind: "unknown", message: `This card is for ${card.startYear}-${Number(card.startYear) + 1}, not ${event.year}.` };
    return admit(eventId, card.kerb, "check-in", by);
  });
}

// Dashboard settings

export async function refreshExecAccess(): Promise<Result<null>> {
  return attempt(async () => {
    await requireExec();
    await execAccess(true);
    return null;
  });
}

// Adds every kerb in an old membership sheet to the list of past members.
// Reads the kerbs on an old membership sheet. Importing the same sheet again replaces its kerbs.
export async function importPastMembers(sheetId: string): Promise<Result<{ found: number }>> {
  return attempt(async () => {
    const by = await requireExec();
    const path = await clubPath(sheetId);
    const rows = await readFirstTab(sheetId);
    const header = (rows[0] || []).map((h) => String(h).toLowerCase());
    let column = header.findIndex((h) => /kerb/.test(h));
    if (column < 0) column = header.findIndex((h) => /e-?mail/.test(h));
    if (column < 0) throw new MembershipError("The first tab needs a Kerberos or email column.");
    const kerbs = new Set<string>();
    for (const row of rows.slice(1)) {
      const raw = String(row[column] || "").toLowerCase().replace(/\s/g, "");
      if (raw.includes("@") && !raw.endsWith("@mit.edu")) continue;
      const kerb = normalizeKerb(raw);
      if (isKerb(kerb)) kerbs.add(kerb);
    }
    if (!kerbs.size) throw new MembershipError("No kerbs found in the first tab.");
    const name = path.at(-1)?.name || "Untitled sheet";
    await savePastSheet({ id: sheetId, name, count: kerbs.size, importedAt: Date.now(), importedBy: by }, [...kerbs]);
    return { found: kerbs.size };
  });
}

// People only on this sheet lose the returning price. People also on another sheet,
// or who paid on this site, keep it.
export async function removePastMembers(sheetId: string): Promise<Result<null>> {
  return attempt(async () => {
    await requireExec();
    await removePastSheet(String(sheetId));
    return null;
  });
}

// Google Form timestamps look like "10/1/2026 14:03:22", in Boston time.
function formTime(value: string) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, month, day, year, hour, minute, second] = match.map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, timeZoneName: "longOffset" })
    .formatToParts(guess).find((p) => p.type === "timeZoneName")!.value;
  const [, sign, hours, minutes] = /GMT([+-])(\d{2}):(\d{2})/.exec(offset) || [, "+", "00", "00"];
  return guess - (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes)) * 60_000;
}

export interface FormImport {
  added: number;
  existing: number;
  // Sheet row numbers whose kerb could not be read.
  unreadable: number[];
}

// This year's members who signed up and paid on the old Google Form. They come in as paid,
// so they can get their Wallet card. Kerbs that already signed up here are left alone.
export async function importFormSignups(sheetId: string): Promise<Result<FormImport>> {
  return attempt(async () => {
    await requireExec();
    const config = await requireCurrentYear();
    await clubPath(sheetId);
    const rows = await readFirstTab(sheetId);
    const header = (rows[0] || []).map((h) => String(h).toLowerCase());
    const column = (...tests: RegExp[]) => {
      for (const test of tests) {
        const index = header.findIndex((h) => test.test(h));
        if (index >= 0) return index;
      }
      return -1;
    };
    const kerbColumn = column(/kerb/, /e-?mail/);
    const nameColumn = column(/name/);
    if (kerbColumn < 0 || nameColumn < 0) throw new MembershipError("The first tab needs a name column and a Kerberos or email column.");
    const classColumn = column(/what year|class/);
    const dormColumn = column(/live|dorm/);
    const paidColumn = column(/venmo|zelle|cash|paid/);
    const notesColumn = column(/question|suggestion|comment/);
    const timeColumn = column(/timestamp/);
    const notesQuestion = config.form.questions.find((q) => !q.builtin && q.type === "long");
    const cell = (row: string[], index: number) => (index < 0 ? "" : String(row[index] ?? "").replace(/\s+/g, " ").trim());

    // A later row for the same kerb replaces an earlier one, since people fix mistakes by submitting again.
    const found = new Map<string, Member>();
    const unreadable: number[] = [];
    rows.slice(1).forEach((row, i) => {
      const raw = cell(row, kerbColumn).toLowerCase().replace(/\s/g, "");
      const name = cell(row, nameColumn).slice(0, 100);
      if (!raw && !name) return;
      const kerb = normalizeKerb(raw);
      if ((raw.includes("@") && !raw.endsWith("@mit.edu")) || !isKerb(kerb) || !name) {
        unreadable.push(i + 2);
        return;
      }
      const paid = cell(row, paidColumn).toLowerCase();
      const method: PaymentMethod = paid.includes("zelle") ? "zelle" : paid.includes("cash") ? "cash" : "venmo";
      const at = formTime(cell(row, timeColumn)) ?? Date.now();
      const notes = cell(row, notesColumn).slice(0, 2000);
      found.set(kerb, {
        year: config.year, kerb, name, classYear: cell(row, classColumn).slice(0, 60), dorm: cell(row, dormColumn).slice(0, 60),
        answers: notes && notesQuestion ? { [notesQuestion.id]: notes } : {},
        type: "new", price: config.prices.new, method, status: "paid",
        reportedAt: at, paidAt: at, paidVia: method, confirmedBy: "Google Form import", venmoMessageId: null, wallet: null, createdAt: at,
      });
    });
    if (!found.size) throw new MembershipError(unreadable.length ? "None of the kerbs on the first tab could be read." : "The first tab has no signups.");

    const added: string[] = [];
    const members = [...found.values()];
    for (let i = 0; i < members.length; i += 20) {
      await Promise.all(members.slice(i, i + 20).map(async (member) => {
        const type = (await hasPaidBefore(member.kerb)) ? ("returning" as const) : ("new" as const);
        if (await claimMember({ ...member, type })) added.push(member.kerb);
      }));
    }
    await markPaidEver(added);
    if (added.length) syncMembersLater(config.year);
    return { added: added.length, existing: members.length - added.length, unreadable };
  });
}
