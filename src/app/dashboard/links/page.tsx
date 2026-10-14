import { headers } from "next/headers";
import LinksView from "@/components/dashboard/LinksView";
import LiveData from "@/components/dashboard/LiveData";
import { allLinks, linkClicks } from "@/lib/links";
import { localDate } from "@/lib/membership/config";
import { publicMessage } from "@/lib/membership/errors";

export default async function LinksPage() {
  const host = (await headers()).get("host") || "csc.mit.edu";
  const origin = `${host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"}://${host}`;
  try {
    const [links, clicks] = await Promise.all([allLinks(), linkClicks()]);
    return (
      <>
        <LiveData renderedAt={Date.now()} />
        <LinksView links={links} clicks={clicks} origin={origin} today={localDate(new Date())} />
      </>
    );
  } catch (error) {
    return <main className="d-page"><p className="m-error" role="alert">{publicMessage(error, "Could not load the links. Please try again.")}</p></main>;
  }
}
