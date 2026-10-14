"use server";

import { emailCardLink } from "@/lib/membership/card-link";
import { isKerb, normalizeKerb } from "@/lib/membership/config";
import { MembershipError, publicMessage } from "@/lib/membership/errors";
import { memberView, ownMember, priceFor, readAnswers, requireOpen, requireOwnMember, setMemberCookie, type MemberView, type SignupInput } from "@/lib/membership/members";
import { clientIp, limit } from "@/lib/membership/rate-limit";
import { attempt, type Result } from "@/lib/membership/result";
import { claimMember, currentYear, getMember, updateMember } from "@/lib/membership/store";
import { syncMembersLater } from "@/lib/membership/sync";
import type { Member, PaymentMethod } from "@/lib/membership/types";
import { checkVenmo } from "@/lib/membership/venmo";
import { walletEnabled } from "@/lib/membership/wallet";

// "yours": this browser already signed up this kerb. "paying": that signup still waits on the payment screen.
export type KerbStatus = { kerb: string; status: "invalid" | "taken" | "yours" | "new" | "returning"; price: number; paying?: boolean };

// Called as the person types their kerb, to show the price or the "already signed up" note.
export async function lookUpKerb(raw: string): Promise<Result<KerbStatus>> {
  return attempt(async () => {
    const config = requireOpen(await currentYear());
    await limit("lookup", await clientIp(), 120, 600);
    const kerb = normalizeKerb(raw);
    if (!isKerb(kerb)) return { kerb, status: "invalid", price: config.prices.new };
    const own = await ownMember(config);
    if (own?.kerb === kerb) return { kerb, status: "yours", price: own.price, paying: own.status === "unpaid" && own.reportedAt === null };
    if (await getMember(config.year, kerb)) return { kerb, status: "taken", price: 0 };
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
    if (input.edit && own && own.kerb !== answers.kerb) throw new MembershipError(`You signed up as ${own.kerb}. Email mitcsc@mit.edu to change your kerb.`);
    // Going back from the payment screen, or filling in the form again with the same kerb, edits the same signup.
    // Another kerb is a new signup, for example a friend's on the same phone, and this browser then follows that one.
    if (own?.kerb === answers.kerb) {
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
    await checkVenmo(config, { minGapSeconds: 4 });
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

// "Email me my card": sends kerb@mit.edu a one-time link that opens the card in that browser.
export async function emailMyCard(raw: string): Promise<Result<{ email: string }>> {
  return attempt(async () => {
    const config = await currentYear();
    if (!config || !walletEnabled()) throw new MembershipError("Membership cards are not set up yet.", 404);
    await limit("card-email-ip", await clientIp(), 10, 3600);
    const kerb = normalizeKerb(raw);
    if (!isKerb(kerb)) throw new MembershipError("Enter your kerb, the part of your MIT email before @mit.edu.");
    await limit("card-email", kerb, 3, 3600);
    const member = await getMember(config.year, kerb);
    if (!member) throw new MembershipError(`${kerb} isn't signed up for ${config.year}.`, 404);
    await emailCardLink(member);
    return { email: `${kerb}@mit.edu` };
  });
}
