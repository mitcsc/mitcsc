import { after } from "next/server";
import { redirect, notFound } from "next/navigation";
import { countClick, resolveShortlink } from "@/lib/links";

export const dynamic = "force-dynamic";

export default async function ShortlinkPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const link = await resolveShortlink(slug);
  if (!link) notFound();
  // Count after the response, so the redirect does not wait on Redis.
  after(() => countClick(link.id));
  redirect(link.url);
}
