import { calendarLink } from "../../config/links";
import type { FormConfig, Question, YearConfig } from "./types";

export const CLUB_EMAIL = "mitcsc@mit.edu";
export const TIME_ZONE = "America/New_York";

export const DORMS = [
  "Baker", "Burton Conner", "East Campus", "MacGregor", "Maseeh", "McCormick", "New House", "New Vassar",
  "Next House", "Random", "Simmons", "Graduate housing", "FSILG", "Off campus", "Other",
];

// The club's main folder in its Drive. Folder pickers open here.
export const CLUB_DRIVE_FOLDER = "MIT CSC";

export const YEAR_PATTERN = /^(\d{4})-(\d{4})$/;

export function isSchoolYear(value: string) {
  const match = YEAR_PATTERN.exec(value);
  return !!match && Number(match[2]) === Number(match[1]) + 1;
}

export function nextSchoolYear(year: string) {
  const start = Number(year.slice(0, 4)) + 1;
  return `${start}-${start + 1}`;
}

// Exec can start the next school year from May 1, when the new board takes over.
export function nextYearOpens(year: string) {
  return `${year.slice(5)}-05-01`;
}

export function canStartNextYear(year: string, now = new Date()) {
  return localDate(now) >= nextYearOpens(year);
}

// A school year starts in August.
export function schoolYearOn(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, year: "numeric", month: "numeric" }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  const start = month >= 8 ? year : year - 1;
  return `${start}-${start + 1}`;
}

// "2026-2027" becomes "2026-27" where space is tight.
export function shortYear(year: string) {
  return `${year.slice(0, 4)}-${year.slice(7)}`;
}

export function classYearOptions(year: string) {
  const end = Number(year.slice(5));
  return [end, end + 1, end + 2, end + 3].map(String).concat("Grad student", "Other");
}

export function defaultForm(year: string): FormConfig {
  return {
    intro: `Membership for ${year}. One payment covers the whole year.`,
    benefits: ["Study breaks", "Boba chats", "Chinatown runs", "Movie nights", "Famlines", "Care packages", "Merch and formal discounts"],
    questions: [
      { id: "kerb", label: "Kerberos", type: "short", required: true, builtin: "kerb" },
      { id: "name", label: "Full name", type: "short", required: true, builtin: "name" },
      { id: "classYear", label: "Class year", type: "dropdown", required: true, builtin: "classYear" },
      { id: "dorm", label: "Where do you live?", type: "dropdown", required: true, builtin: "dorm", options: DORMS },
      { id: "notes", label: "Questions or suggestions", type: "long", required: false },
    ],
    calendarUrl: calendarLink,
    instagram: "mitcsc",
  };
}

// The intro mentions the year, so carry it forward when the text was not customized.
export function carryForm(form: FormConfig, from: string, to: string): FormConfig {
  return { ...form, intro: form.intro.split(from).join(to), questions: form.questions.map((q) => ({ ...q })) };
}

export function questionOptions(question: Question, year: string) {
  if (question.builtin === "classYear") return classYearOptions(year);
  if (question.builtin === "dorm") return question.options?.length ? question.options : DORMS;
  return question.options || [];
}

export function newYearConfig(year: string, previous: YearConfig | null): YearConfig {
  const endYear = Number(year.slice(5));
  return {
    year,
    signupsOpen: false,
    closesOn: null,
    walletExpiresOn: `${endYear}-06-01`,
    prices: previous ? { ...previous.prices } : { new: 8, returning: 6 },
    venmo: previous?.venmo || "xiong-mao",
    zelle: previous ? previous.zelle : "650-390-3742",
    cashAllowed: previous?.cashAllowed ?? true,
    form: previous ? carryForm(previous.form, previous.year, year) : defaultForm(year),
    folderId: null,
    eventsFolderId: null,
    sheetId: null,
    sheetName: `CSC ${year} Membership`,
    createdAt: Date.now(),
  };
}

// Signups close at the end of the chosen day in Boston.
export function signupsAreOpen(config: YearConfig, now = new Date()) {
  if (!config.signupsOpen) return false;
  if (!config.closesOn) return true;
  return localDate(now) <= config.closesOn;
}

export function localDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(date);
}

export function formatDay(isoDate: string, withYear = false) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatTime(ms: number) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIME_ZONE }).format(ms);
}

export function formatStamp(ms: number) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: TIME_ZONE }).format(ms);
}

export function money(amount: number) {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

// No spaces: Venmo can turn an encoded space in the link into a literal "+".
export function venmoNote(year: string, kerb: string) {
  return `CSC-${year}-${kerb}`;
}

export function venmoLink(config: YearConfig, kerb: string, price: number) {
  const params = new URLSearchParams({ txn: "pay", amount: String(price), note: venmoNote(config.year, kerb), audience: "private" });
  return `https://venmo.com/${encodeURIComponent(config.venmo)}?${params.toString()}`;
}

export function normalizeKerb(input: string) {
  return input.trim().toLowerCase().replace(/@mit\.edu$/, "");
}

export function isKerb(kerb: string) {
  return /^[a-z][a-z0-9_]{1,7}$/.test(kerb);
}
