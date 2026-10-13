"use server";

import { isKerb, isSchoolYear, newYearConfig, normalizeKerb } from "@/lib/membership/config";
import { MembershipError } from "@/lib/membership/errors";
import { clearExecAccessCache, execAccess, requireExec } from "@/lib/membership/exec-auth";
import { createFolder, findOrCreateFolder, getItem, itemPath, listChildren, listShared, FOLDER, SPREADSHEET } from "@/lib/membership/google/drive";
import { clubEmail } from "@/lib/membership/google/oauth";
import { addTab, createSheet, readFirstTab } from "@/lib/membership/google/sheets";
import { cleanForm, text } from "@/lib/membership/form";
import { attempt, type Result } from "@/lib/membership/result";
import { readCardToken } from "@/lib/membership/signing";
import {
  attendanceCount, checkIn, createEvent, getAttendance, createYear, currentYear, deleteMember, getEvent, getMember, getYear, markPaidEver,
  requireCurrentYear, unmarkPaidEver, updateEvent, updateMember, updateYear,
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

export async function browseDrive(folderId: string, includeSheets: boolean): Promise<Result<DriveListing>> {
  return attempt(async () => {
    await requireExec();
    // "root" is My Drive and "shared" is Shared with me.
    const id = folderId || "root";
    const [path, children] = await Promise.all([
      id === "root" || id === "shared" ? [] : itemPath(id),
      id === "shared" ? listShared(includeSheets) : listChildren(id, includeSheets),
    ]);
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
    const folder = await createFolder(clean, !parentId || parentId === "shared" ? "root" : parentId);
    return { id: folder.id, name: folder.name };
  });
}

// New school year: "<base>/MIT CSC <year>/Membership/CSC <year> Membership".
export async function createSchoolYear(input: { year: string; baseFolderId: string; sheetName: string; prices: { new: number; returning: number } }): Promise<Result<string>> {
  return attempt(async () => {
    const by = await requireExec();
    if (!isSchoolYear(input.year)) throw new MembershipError("Pick a school year like 2027-2028.");
    if (await getYear(input.year)) throw new MembershipError(`${input.year} already exists.`, 409);
    const previous = await currentYear();
    const sheetName = text(input.sheetName, 100) || `CSC ${input.year} Membership`;
    const base = await getItem(input.baseFolderId || "root");
    if (base.mimeType !== FOLDER && input.baseFolderId) throw new MembershipError("Pick a folder.");
    const yearFolder = await findOrCreateFolder(`MIT CSC ${input.year}`, base.id);
    const membershipFolder = await findOrCreateFolder("Membership", yearFolder.id);
    const sheetId = await createSheet(sheetName, membershipFolder.id, "Members", clubEmail());
    const config: YearConfig = {
      ...newYearConfig(input.year, previous),
      prices: { new: price(input.prices.new, "new member"), returning: price(input.prices.returning, "returning member") },
      folderId: yearFolder.id,
      membershipFolderId: membershipFolder.id,
      sheetId,
      sheetName,
    };
    await createYear(config);
    // The new folder decides who has exec access.
    await clearExecAccessCache();
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
      const sheet = await getItem(input.sheetId);
      if (sheet.mimeType !== SPREADSHEET) throw new MembershipError("Pick a Google Sheet.");
      sheetTab = await addTab(sheet.id, name.slice(0, 90), clubEmail());
      sheetId = sheet.id;
    } else if (config.folderId || input.folderId) {
      let folderId = input.folderId;
      if (!folderId) {
        folderId = config.eventsFolderId || (await findOrCreateFolder("Events", config.folderId!)).id;
        if (!config.eventsFolderId) await updateYear(config.year, (c) => ({ ...c, eventsFolderId: folderId }));
      }
      sheetId = await createSheet(name, folderId, sheetTab, clubEmail());
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
export async function importPastMembers(sheetId: string): Promise<Result<{ found: number }>> {
  return attempt(async () => {
    await requireExec();
    const rows = await readFirstTab(sheetId);
    const header = (rows[0] || []).map((h) => String(h).toLowerCase());
    let column = header.findIndex((h) => /kerb/.test(h));
    if (column < 0) column = header.findIndex((h) => /e-?mail/.test(h));
    if (column < 0) throw new MembershipError("The first tab needs a Kerberos or email column.");
    const kerbs = new Set<string>();
    for (const row of rows.slice(1)) {
      const raw = String(row[column] || "").trim().toLowerCase();
      if (raw.includes("@") && !raw.endsWith("@mit.edu")) continue;
      const kerb = normalizeKerb(raw);
      if (isKerb(kerb)) kerbs.add(kerb);
    }
    if (!kerbs.size) throw new MembershipError("No kerbs found in the first tab.");
    await markPaidEver([...kerbs]);
    return { found: kerbs.size };
  });
}
