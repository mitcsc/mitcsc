"use server";

import { headers } from "next/headers";
import { isKerb, normalizeKerb } from "@/lib/membership/config";
import { MembershipError, publicMessage } from "@/lib/membership/errors";
import { memberView, ownMember, priceFor, readAnswers, requireOpen, requireOwnMember, setMemberCookie, type MemberView, type SignupInput } from "@/lib/membership/members";
import { clientIp, limit } from "@/lib/membership/rate-limit";
import { attempt, type Result } from "@/lib/membership/result";
import { claimMember, currentYear, getMember, updateMember } from "@/lib/membership/store";
import { syncMembersLater } from "@/lib/membership/sync";
import type { Member, PaymentMethod } from "@/lib/membership/types";
import { checkVenmo } from "@/lib/membership/venmo";
import { createPass, walletEnabled } from "@/lib/membership/wallet";

export type KerbStatus = { kerb: string; status: "invalid" | "taken" | "new" | "returning"; price: number };

// Called as the person types their kerb, to show the price or the "already signed up" note.
export async function lookUpKerb(raw: string): Promise<Result<KerbStatus>> {
  return attempt(async () => {
    const config = requireOpen(await currentYear());
    await limit("lookup", await clientIp(), 120, 600);
    const kerb = normalizeKerb(raw);
    if (!isKerb(kerb)) return { kerb, status: "invalid", price: config.prices.new };
    const own = await ownMember(config);
    if (own?.kerb !== kerb && (await getMember(config.year, kerb))) return { kerb, status: "taken", price: 0 };
    const { type, price } = await priceFor(config, kerb);
    return { kerb, status: type, price };
  });
}

export async function signUp(input: SignupInput): Promise<Result<MemberView>> {
  return attempt(async () => {
    const config = requireOpen(await currentYear());
    const answers = readAnswers(config, input);
    await limit("signup-ip", await clientIp(), 20, 600);
    await limit("signup-kerb", answers.kerb, 8, 600);
    const own = await ownMember(config);
    // Going back from the payment screen edits the same signup.
    if (own) {
      if (own.kerb !== answers.kerb) throw new MembershipError(`This browser already signed up ${own.kerb}. Email mitcsc@mit.edu to change it.`);
      const member = await updateMember(config.year, own.kerb, (m) => ({ ...m, name: answers.name, classYear: answers.classYear, dorm: answers.dorm, answers: answers.answers }));
      syncMembersLater(config.year);
      return memberView(member);
    }
    const { type, price } = await priceFor(config, answers.kerb);
    const member: Member = {
      year: config.year, ...answers, type, price, method: "venmo", status: "unpaid",
      reportedAt: null, paidAt: null, paidVia: null, confirmedBy: null, venmoMessageId: null, wallet: null, createdAt: Date.now(),
    };
    if (!(await claimMember(member))) throw new MembershipError(`${answers.kerb} is already signed up for ${config.year}.`, 409);
    await setMemberCookie(config.year, answers.kerb);
    syncMembersLater(config.year);
    return memberView(member);
  });
}

// "I've paid" (Venmo, Zelle) or "I'll pay at an event" (cash).
export async function reportPayment(method: PaymentMethod): Promise<Result<MemberView>> {
  return attempt(async () => {
    const { config, member } = await requireOwnMember();
    if (!["venmo", "zelle", "cash"].includes(method) || (method === "cash" && !config.cashAllowed)) throw new MembershipError("Pick a payment method.");
    if (method === "zelle" && !config.zelle) throw new MembershipError("Zelle is not available right now.");
    await limit("report", member.kerb, 30, 600);
    let updated = member.status === "paid" ? member : await updateMember(config.year, member.kerb, (m) => ({ ...m, method, reportedAt: m.reportedAt ?? Date.now() }));
    if (method === "venmo" && updated.status === "unpaid") updated = await venmoCheckFor(updated);
    syncMembersLater(config.year);
    return memberView(updated);
  });
}

async function venmoCheckFor(member: Member) {
  const config = await currentYear();
  if (!config) return member;
  try {
    await checkVenmo(config, { minGapSeconds: 15 });
  } catch (error) {
    // A Gmail problem must not block the member. Exec confirm by hand.
    publicMessage(error);
  }
  return (await getMember(config.year, member.kerb)) || member;
}

// Polled for about two minutes after "I've paid" with Venmo.
export async function refreshStatus(): Promise<Result<MemberView>> {
  return attempt(async () => {
    const { member } = await requireOwnMember();
    await limit("refresh", member.kerb, 40, 600);
    const updated = member.status === "unpaid" && member.method === "venmo" && member.reportedAt ? await venmoCheckFor(member) : member;
    return memberView(updated);
  });
}

// Makes the Wallet card on first use and returns the page that adds it to Apple or Google Wallet.
export async function walletLink(): Promise<Result<string>> {
  return attempt(async () => {
    const { config, member } = await requireOwnMember();
    if (member.wallet) return member.wallet.shareUrl;
    if (!walletEnabled()) throw new MembershipError("Wallet cards are not set up yet.", 503);
    await limit("wallet", member.kerb, 5, 3600);
    const list = await headers();
    const origin = `${list.get("x-forwarded-proto") || "https"}://${list.get("host")}`;
    const pass = await createPass(config, member, origin);
    const updated = await updateMember(config.year, member.kerb, (m) => (m.wallet ? m : { ...m, wallet: pass }));
    return updated.wallet!.shareUrl;
  });
}
