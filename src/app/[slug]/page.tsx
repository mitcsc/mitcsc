import { redirect, notFound } from "next/navigation";
import { resolveShortlink } from "@/lib/links";

export default async function ShortlinkPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const url = await resolveShortlink(slug);

  if (url) redirect(url);
  notFound();
}
