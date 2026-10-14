import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import MembershipFlow, { type PublicYear } from "@/components/membership/MembershipFlow";
import type { WalletInfo } from "@/components/membership/WalletButtons";
import { resolveShortlink } from "@/lib/links";
import { signupsAreOpen, venmoLink } from "@/lib/membership/config";
import { memberView, ownMember } from "@/lib/membership/members";
import { qrSvg } from "@/lib/membership/qr";
import { currentYear } from "@/lib/membership/store";
import { WALLET_PROBLEMS, walletButtons, walletEnabled, type WalletProblem } from "@/lib/membership/wallet";
import "@/components/membership/ui.css";
import "./membership.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join CSC",
  description: "Become a member of the MIT Chinese Students Club for the school year.",
};

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ wallet?: string }> }) {
  const config = await currentYear();
  const problem = (await searchParams).wallet;
  const wallet: WalletInfo = {
    buttons: walletButtons((await headers()).get("user-agent")),
    problem: typeof problem === "string" && problem in WALLET_PROBLEMS ? WALLET_PROBLEMS[problem as WalletProblem] : null,
  };
  if (!config) {
    // Until exec set up the first school year here, keep sending people to the old signup form.
    const fallback = await resolveShortlink("membership");
    if (fallback) redirect(fallback);
    return <MembershipFlow year={null} member={null} venmo={null} wallet={wallet} />;
  }
  const member = await ownMember(config);
  // A Wallet button found no signup in this browser, so offer the email link.
  if (!member && problem === "missing") redirect("/join/card");

  const year: PublicYear = {
    year: config.year,
    open: signupsAreOpen(config),
    prices: config.prices,
    venmo: config.venmo,
    zelle: config.zelle,
    cashAllowed: config.cashAllowed,
    form: config.form,
    wallet: walletEnabled(),
  };
  // The Venmo link and its QR code need the kerb, so they exist only after signup.
  const venmo = member && member.status === "unpaid"
    ? (() => {
        const url = venmoLink(config, member.kerb, member.price);
        return { kerb: member.kerb, url, qr: qrSvg(url, "QR code that opens Venmo with the payment filled in") };
      })()
    : null;
  return <MembershipFlow year={year} member={member ? memberView(member) : null} venmo={venmo} wallet={wallet} />;
}
