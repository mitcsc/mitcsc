"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { after } from "next/server";
import { HOME_PHOTOS_TAG, photoLibrary, refreshPhotoLibrary, setPhotosShown, shownPhotoIds, warmHomePhotos } from "@/lib/home-photos";
import { localMode } from "@/lib/local-mode";
import { canStartNextYear, formatDay, isKerb, isSchoolYear, newYearConfig, nextYearOpens, normalizeKerb, schoolYearOn } from "@/lib/membership/config";
import { MembershipError } from "@/lib/membership/errors";
import { execAccess, knownClubFolder, requireExec } from "@/lib/membership/exec-auth";
import { GoogleApiError } from "@/lib/membership/google/api";
import { clubPath, createFolder, getItem, listChildren, renameFile, trashFile, FOLDER } from "@/lib/membership/google/drive";
import { clubEmail } from "@/lib/membership/google/oauth";
import { createSheet } from "@/lib/membership/google/sheets";
import { cleanForm, text } from "@/lib/membership/form";
import { keys } from "@/lib/membership/keys";
import { withLock } from "@/lib/membership/redis";
import { attempt, type Result } from "@/lib/membership/result";
import { readCardToken } from "@/lib/membership/signing";
import {
  attendanceCount, checkIn, claimMember, undoCheckIn, createEvent, eventsOn, deleteEvent, getAttendance, createYear, currentYear, deleteMember, getEvent, getMember, getYear, markPaidEver,
  requireCurrentYear, unmarkPaidEver, updateEvent, updateMember, updateYear,
} from "@/lib/membership/store";
import { syncEventLater, syncMembersLater, syncMembersNow } from "@/lib/membership/sync";
import type { Attendance, EventInfo, FormConfig, Member, PaymentMethod, YearConfig } from "@/lib/membership/types";
import { checkInState, clashes, clashNote, CLOCK_TIME, type EventHours } from "@/lib/membership/event-times";
import { priceFor } from "@/lib/membership/members";
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

// What the Add member dialog shows as an exec types a kerb.
export type NewMemberKerb = { status: "invalid" | "taken" | "new" | "returning"; price: number };

export async function lookUpNewMember(raw: string): Promise<Result<NewMemberKerb>> {
  return attempt(async () => {
    await requireExec();
    const config = await requireCurrentYear();
    const kerb = normalizeKerb(raw);
    if (!isKerb(kerb)) return { status: "invalid", price: 0 };
    if (await getMember(config.year, kerb)) return { status: "taken", price: 0 };
    const { type, price } = await priceFor(config, kerb);
    return { status: type, price };
  });
}

interface NewMember {
  kerb: string;
  name: string;
  classYear: string;
  dorm: string;
  // How they already paid, or null when they still owe.
  paidVia: PaymentMethod | null;
}

// An exec adds someone by hand, for example a member who paid before the site took signups.
// It works while signups are closed. Someone who still owes pays at an event.
export async function addMember(input: NewMember): Promise<Result<Member>> {
  return attempt(async () => {
    const by = await requireExec();
    const config = await requireCurrentYear();
    const kerb = normalizeKerb(String(input.kerb ?? ""));
    if (!isKerb(kerb)) throw new MembershipError("Enter their kerb, the part of their MIT email before @mit.edu.");
    const line = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
    const name = line(input.name, 100);
    if (!name) throw new MembershipError("Enter their full name.");
    const paidVia = input.paidVia === null ? null : input.paidVia;
    if (paidVia !== null && !METHODS.includes(paidVia)) throw new MembershipError("Pick how they paid.");
    const { type, price } = await priceFor(config, kerb);
    const now = Date.now();
    const member: Member = {
      year: config.year, kerb, name, classYear: line(input.classYear, 60), dorm: line(input.dorm, 60), answers: {}, type, price,
      method: paidVia ?? "cash", status: paidVia ? "paid" : "unpaid", reportedAt: null,
      paidAt: paidVia ? now : null, paidVia, confirmedBy: paidVia ? by : null, venmoMessageId: null, wallet: null, createdAt: now,
    };
    if (!(await claimMember(member))) throw new MembershipError(`${kerb} is already signed up for ${config.year}.`, 409);
    if (paidVia) await markPaidEver([kerb]);
    syncMembersLater(config.year);
    return member;
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
    const root = await knownClubFolder();
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
    const root = await knownClubFolder();
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
    // One at a time, so two exec starting the year together do not each make a sheet.
    return withLock(keys.lock(`year:${input.year}`), "Someone else is starting this school year. Try again in a moment.", async () => {
      if (await getYear(input.year)) throw new MembershipError(`${input.year} already exists.`, 409);
      const previous = await currentYear();
      if (previous && !canStartNextYear(previous.year)) {
        throw new MembershipError(`You can start the next school year from ${formatDay(nextYearOpens(previous.year), true)}.`);
      }
      const sheetName = text(input.sheetName, 100) || `CSC ${input.year} Membership`;
      if (!input.folderId) throw new MembershipError("Pick the folder for the membership sheet.");
      await clubPath(input.folderId, await knownClubFolder());
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
  });
}

// Local mode has no Google Sheet, so its test year starts without one.
export async function startTestYear() {
  await requireExec();
  if (!localMode()) throw new MembershipError("Only local mode can start a year without Google.", 403);
  const year = schoolYearOn(new Date());
  if (!(await getYear(year))) await createYear(newYearConfig(year, await currentYear()));
  revalidatePath("/dashboard", "layout");
}

// Events

// Event hours from a form: both times or neither, with the end after the start.
function eventHours(starts: unknown, ends: unknown) {
  const [from, to] = [starts, ends].map((t) => (typeof t === "string" ? t.trim() : ""));
  if (!from && !to) return { starts: null, ends: null };
  if (!CLOCK_TIME.test(from) || !CLOCK_TIME.test(to)) throw new MembershipError("Give both a start and an end time, or neither.");
  if (to <= from) throw new MembershipError("The end time must be after the start time.");
  return { starts: from, ends: to };
}

// Events on the same day cannot overlap. Changes to one day's events run one at a time,
// so two exec creating an event together get one event, not two.
function lockDay<T>(year: string, date: string, work: () => Promise<T>) {
  return withLock(keys.lock(`events:${year}:${date}`), "Someone else is saving an event on this day. Try again in a moment.", work);
}

async function refuseClash(year: string, hours: EventHours, exceptId?: string) {
  const clash = (await eventsOn(year, hours.date)).find((e) => e.id !== exceptId && clashes(e, hours));
  if (clash) throw new MembershipError(clashNote(clash), 409);
}

// Each event gets its own new sheet in the picked folder, or no sheet when Google is not connected.
export async function createEventAction(input: { name: string; date: string; starts: string; ends: string; folderId: string | null }): Promise<Result<string>> {
  return attempt(async () => {
    const by = await requireExec();
    const config = await requireCurrentYear();
    const name = text(input.name, 100);
    if (!name) throw new MembershipError("Name the event.");
    if (!ISO_DATE.test(input.date)) throw new MembershipError("Pick the event date.");
    const hours = eventHours(input.starts, input.ends);
    const event = await lockDay(config.year, input.date, async () => {
      // Checked before the Google Sheet is made, so a refused event leaves nothing in Drive.
      await refuseClash(config.year, { date: input.date, ...hours });
      let sheetId: string | null = null;
      const sheetTab = "Attendance";
      if (input.folderId) {
        const { id: folderId } = (await clubPath(input.folderId, await knownClubFolder())).at(-1)!;
        sheetId = await createSheet(name, folderId, sheetTab, clubEmail());
      }
      return createEvent({ year: config.year, name, date: input.date, ...hours, checkIn: null, sheetId, sheetTab, createdBy: by });
    });
    syncEventLater(event.id);
    return event.id;
  });
}

// Saves an event's name and hours. New hours replace an exec's earlier close or reopen.
export async function saveEvent(id: string, input: { name: string; starts: string; ends: string }): Promise<Result<null>> {
  return attempt(async () => {
    await requireExec();
    const clean = text(input.name, 100);
    if (!clean) throw new MembershipError("Name the event.");
    const hours = eventHours(input.starts, input.ends);
    const current = await getEvent(String(id));
    if (!current) throw new MembershipError("This event does not exist.", 404);
    const moved = (current.starts || null) !== hours.starts || (current.ends || null) !== hours.ends;
    const event = await lockDay(current.year, current.date, async () => {
      await refuseClash(current.year, { date: current.date, ...hours }, current.id);
      return updateEvent(id, (e) => ({ ...e, name: clean, ...hours, checkIn: moved ? null : e.checkIn, checkInAt: moved ? null : e.checkInAt }));
    });
    // The sheet keeps the event's name. A sheet someone already removed from Drive needs nothing.
    if (event.sheetId && clean !== current.name) {
      await renameFile(event.sheetId, clean).catch((error) => {
        if (error instanceof GoogleApiError && error.googleStatus === 404) return;
        throw new MembershipError("The event has the new name, but its Google Sheet does not. Check the club Google account in Settings, then save the name again.", 502);
      });
    }
    return null;
  });
}

// Closes or reopens check-in by hand. A choice that matches the hours is dropped, so the hours apply again.
// Opening by hand lasts 12 hours from now.
export async function setEventCheckIn(id: string, open: boolean): Promise<Result<null>> {
  return attempt(async () => {
    await requireExec();
    await updateEvent(String(id), (e) => {
      const now = new Date();
      const scheduled = checkInState({ ...e, checkIn: null }, now).open;
      const checkIn = open === scheduled ? null : open ? "open" : "closed";
      return { ...e, checkIn, checkInAt: checkIn === "open" ? now.getTime() : null };
    });
    return null;
  });
}

export async function deleteEventAction(id: string): Promise<Result<null>> {
  return attempt(async () => {
    await requireExec();
    const event = await getEvent(String(id));
    if (!event) return null;
    // The sheet goes first, so a Google problem leaves the event in place to try again.
    if (event.sheetId) {
      await trashFile(event.sheetId).catch((error) => {
        if (error instanceof GoogleApiError && error.googleStatus === 404) return;
        throw new MembershipError("Could not move the event’s Google Sheet to the trash, so nothing was deleted. Check the club Google account in Settings, then try again.", 502);
      });
    }
    await deleteEvent(event);
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
// Each step reads what it can at the same time, since exec wait on this at the door.
async function admit(event: EventInfo | null, kerb: string, mode: "check-in" | "confirm" | "anyway", by: string): Promise<CheckInResult> {
  if (!event) throw new MembershipError("This event does not exist.", 404);
  if (!checkInState(event, new Date()).open) throw new MembershipError(`Check-in for “${event.name}” is closed. Reopen it to check people in.`, 409);
  const [config, found] = await Promise.all([getYear(event.year), getMember(event.year, kerb)]);
  let member = found;
  if (!config || !member) return { kind: "unknown", message: `${kerb} is not signed up for ${event.year}.` };
  if (member.status !== "paid" && mode === "confirm") member = await setPaid(config, kerb, member.method, by);
  if (member.status !== "paid" && mode === "check-in") {
    const { record, count } = await getAttendance(event.id, kerb);
    return record ? { kind: "already", person: person(member), record, count } : { kind: "unpaid", person: person(member), count };
  }
  const result = await checkIn(event.id, { kerb, name: member.name, classYear: member.classYear, paid: member.status === "paid", at: Date.now(), by });
  if (result.added) syncEventLater(event.id);
  return { kind: result.added ? "checked-in" : "already", person: person(member), record: result.record, count: result.count };
}

export async function checkInPerson(eventId: string, kerb: string, mode: "check-in" | "confirm" | "anyway"): Promise<Result<CheckInResult>> {
  return attempt(async () => {
    const clean = normalizeKerb(kerb);
    if (!isKerb(clean)) throw new MembershipError("That is not a kerb.");
    // The event is only used once the sign-in checks out.
    const [by, event] = await Promise.all([requireExec(), getEvent(eventId)]);
    return admit(event, clean, mode, by);
  });
}

// Takes a person off the event's attendance, for a check-in made by mistake.
export async function undoCheckInPerson(eventId: string, kerb: string): Promise<Result<{ count: number }>> {
  return attempt(async () => {
    const [, event] = await Promise.all([requireExec(), getEvent(eventId)]);
    if (!event) throw new MembershipError("This event does not exist.", 404);
    if (await undoCheckIn(eventId, normalizeKerb(kerb))) syncEventLater(eventId);
    return { count: await attendanceCount(eventId) };
  });
}

export async function scanCard(eventId: string, value: string): Promise<Result<CheckInResult>> {
  return attempt(async () => {
    const [by, event] = await Promise.all([requireExec(), getEvent(eventId)]);
    const card = readCardToken(value);
    if (!card) return { kind: "unknown", message: "That QR code is not a CSC membership card." };
    if (!event) throw new MembershipError("This event does not exist.", 404);
    if (!event.year.startsWith(`${card.startYear}-`)) return { kind: "unknown", message: `This card is for ${card.startYear}-${Number(card.startYear) + 1}, not ${event.year}.` };
    return admit(event, card.kerb, "check-in", by);
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

// Home page photos

// Lists the Drive folder again. The Photos page calls this after it shows the saved list.
export async function refreshHomePhotos(): Promise<Result<null>> {
  return attempt(async () => {
    await requireExec();
    await refreshPhotoLibrary().catch((error) => {
      throw error instanceof MembershipError ? error : new MembershipError("Could not read the Drive folder.", 502);
    });
    return null;
  });
}

// Turns photos on or off for the home page. Returns the ids that are on afterwards.
export async function setHomePhotos(ids: string[], shown: boolean): Promise<Result<string[]>> {
  return attempt(async () => {
    await requireExec();
    const library = await photoLibrary();
    const known = new Set([...(library?.photos || []), ...(library?.missing || [])].map((p) => p.id));
    const chosen = new Set(ids.filter((id) => known.has(id)));
    await setPhotosShown([...chosen], !!shown);
    revalidateTag(HOME_PHOTOS_TAG);
    revalidatePath("/");
    if (shown) after(() => warmHomePhotos((library?.photos || []).filter((p) => chosen.has(p.id))));
    return shownPhotoIds();
  });
}
