import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import CardClaim from "@/components/membership/CardClaim";
import { cardLinkIsLive } from "@/lib/membership/card-link";
import { normalizeKerb } from "@/lib/membership/config";
import { ownMember } from "@/lib/membership/members";
import { currentYear } from "@/lib/membership/store";
import { walletButtons } from "@/lib/membership/wallet";
import "@/components/membership/ui.css";
import "../membership.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Get your CSC card",
  description: "Get your MIT CSC membership card for Apple Wallet or Google Wallet.",
};

export default async function CardPage({ searchParams }: { searchParams: Promise<{ link?: string; kerb?: string }> }) {
  const { link, kerb } = await searchParams;
  const config = await currentYear();
  const live = typeof link === "string" && config && (await cardLinkIsLive(link)) ? link : null;
  // This browser already has a signup, for example from an earlier tap on the email's link,
  // so the card is one tap away on /join.
  if (!live && (await ownMember(config))) redirect("/join");
  return (
    <CardClaim
      year={config?.year || null}
      link={live}
      deadLink={!!link && !live}
      buttons={walletButtons((await headers()).get("user-agent"))}
      kerb={typeof kerb === "string" ? normalizeKerb(kerb).slice(0, 8) : ""}
    />
  );
}
