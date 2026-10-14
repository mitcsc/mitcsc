import type { Metadata } from "next";
import { headers } from "next/headers";
import CardClaim from "@/components/membership/CardClaim";
import { cardLinkIsLive } from "@/lib/membership/card-link";
import { normalizeKerb } from "@/lib/membership/config";
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
