import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import CardClaim from "@/components/membership/CardClaim";
import { cardLinkIsLive } from "@/lib/membership/card-link";
import { normalizeKerb } from "@/lib/membership/config";
import { currentYear } from "@/lib/membership/store";
import { walletAvailable, walletButtons } from "@/lib/membership/wallet";
import "@/components/membership/ui.css";
import "../membership.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Add to your digital wallet",
  description: "Add your MIT CSC membership card to Apple Wallet or Google Wallet.",
};

export default async function CardPage({ searchParams }: { searchParams: Promise<{ link?: string; kerb?: string }> }) {
  // Without Wallet cards (not set up, or paused at the monthly limit) there is nothing to get here.
  if (!(await walletAvailable())) redirect("/join");
  const { link, kerb } = await searchParams;
  const config = await currentYear();
  const live = typeof link === "string" && config && (await cardLinkIsLive(link)) ? link : null;
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
