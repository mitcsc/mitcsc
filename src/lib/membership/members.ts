import { cookies } from "next/headers";
import { isKerb, normalizeKerb, questionOptions, signupsAreOpen } from "./config";
import { MembershipError } from "./errors";
import { sign, verify } from "./signing";
import { currentYear, getMember, hasPaidBefore } from "./store";
import type { Member, PaymentMethod, YearConfig } from "./types";

const MEMBER_COOKIE = "csc_member";
const MEMBER_COOKIE_MS = 365 * 24 * 3600_000;

export interface SignupInput {
  answers: Record<string, string | string[]>;
  // Free text for "Other" on the class year and dorm dropdowns.
  other: Record<string, string>;
  // True when the person went back from the payment screen to change their answers.
  edit?: boolean;
}

// What the member's own browser may see about their signup.
export interface MemberView {
  year: string;
  kerb: string;
  name: string;
  answers: Record<string, string | string[]>;
  classYear: string;
  dorm: string;
  type: "new" | "returning";
  price: number;
  method: PaymentMethod;
  status: "unpaid" | "paid";
  reported: boolean;
  paidVia: PaymentMethod | null;
}

export function memberView(m: Member): MemberView {
  return {
    year: m.year, kerb: m.kerb, name: m.name, answers: m.answers, classYear: m.classYear, dorm: m.dorm,
    type: m.type, price: m.price, method: m.method, status: m.status, reported: m.reportedAt !== null, paidVia: m.paidVia,
  };
}

export async function setMemberCookie(year: string, kerb: string) {
  (await cookies()).set(MEMBER_COOKIE, sign("member", { year, kerb }, MEMBER_COOKIE_MS), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: MEMBER_COOKIE_MS / 1000,
  });
}

// The signup this browser made for the current year, if any.
export async function ownMember(config: YearConfig | null) {
  if (!config) return null;
  const owner = verify<{ year: string; kerb: string }>("member", (await cookies()).get(MEMBER_COOKIE)?.value);
  if (!owner || owner.year !== config.year) return null;
  return getMember(config.year, owner.kerb);
}

export async function requireOwnMember() {
  const config = await currentYear();
  const member = await ownMember(config);
  if (!config || !member) throw new MembershipError("We couldn't find your signup. Please sign up again.", 404);
  return { config, member };
}

export function requireOpen(config: YearConfig | null): YearConfig {
  if (!config || !signupsAreOpen(config)) throw new MembershipError("Signups are closed right now.", 403);
  return config;
}

export async function priceFor(config: YearConfig, kerb: string) {
  const type = (await hasPaidBefore(kerb)) ? ("returning" as const) : ("new" as const);
  return { type, price: config.prices[type === "returning" ? "returning" : "new"] };
}

function oneLine(value: unknown, label: string, max: number, required: boolean) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (required && !text) throw new MembershipError(`Please fill in “${label}”.`);
  if (text.length > max) throw new MembershipError(`“${label}” is too long.`);
  return text;
}

// Checks every answer against this year's form. Unknown questions are dropped.
export function readAnswers(config: YearConfig, input: SignupInput) {
  const out = { kerb: "", name: "", classYear: "", dorm: "", answers: {} as Record<string, string | string[]> };
  for (const q of config.form.questions) {
    const raw = input.answers?.[q.id];
    if (q.builtin === "kerb") {
      out.kerb = normalizeKerb(typeof raw === "string" ? raw : "");
      if (!isKerb(out.kerb)) throw new MembershipError("Enter your kerb, the part of your MIT email before @mit.edu.");
      continue;
    }
    if (q.builtin === "name") {
      out.name = oneLine(raw, q.label, 100, true);
      continue;
    }
    if (q.type === "short" || q.type === "long") {
      const max = q.type === "short" ? 200 : 2000;
      const text = typeof raw === "string" ? raw.trim() : "";
      if (q.required && !text) throw new MembershipError(`Please answer “${q.label}”.`);
      if (text.length > max) throw new MembershipError(`Your answer to “${q.label}” is too long.`);
      if (text) out.answers[q.id] = text;
      continue;
    }
    const options = questionOptions(q, config.year);
    if (q.type === "checkboxes") {
      const picked = Array.isArray(raw) ? raw.filter((v) => options.includes(v)) : [];
      if (q.required && !picked.length) throw new MembershipError(`Please answer “${q.label}”.`);
      if (picked.length) out.answers[q.id] = [...new Set(picked)];
      continue;
    }
    let choice = typeof raw === "string" && options.includes(raw) ? raw : "";
    if ((q.required || q.builtin) && !choice) throw new MembershipError(`Please answer “${q.label}”.`);
    if (choice === "Other" && (q.builtin === "classYear" || q.builtin === "dorm")) {
      choice = oneLine(input.other?.[q.id], q.label, 60, true);
    }
    if (q.builtin === "classYear") out.classYear = choice;
    else if (q.builtin === "dorm") out.dorm = choice;
    else if (choice) out.answers[q.id] = choice;
  }
  return out;
}
