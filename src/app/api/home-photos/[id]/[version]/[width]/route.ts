import sharp from "sharp";
import { PHOTO_WIDTHS } from "@/lib/home-photo-urls";
import { isPhotoShown, photoLibrary } from "@/lib/home-photos";
import { hasExecAccess, signedInEmail } from "@/lib/membership/exec-auth";
import { downloadFile } from "@/lib/membership/google/drive";

export const runtime = "nodejs";
export const maxDuration = 60;

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

// Serves a home page photo from Drive, resized to one of PHOTO_WIDTHS.
// Photos that are on the home page are public and cached for a year. Others are for exec only, for the dashboard.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; version: string; width: string }> }) {
  const { id, version, width } = await params;
  const size = Number(width);
  if (!PHOTO_WIDTHS.includes(size)) return notFound();
  const photo = (await photoLibrary())?.photos.find((p) => p.id === id && p.version === version);
  if (!photo) return notFound();
  const shown = await isPhotoShown(id);
  if (!shown) {
    const email = await signedInEmail();
    if (!email || !(await hasExecAccess(email))) return notFound();
  }
  let image: Buffer;
  try {
    image = await sharp(await downloadFile(id), { failOn: "none" })
      .rotate()
      .resize({ width: size, withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
  } catch (error) {
    console.error(JSON.stringify({ event: "home_photo_error", message: error instanceof Error ? error.message : "unknown" }));
    return new Response("This photo could not be loaded.", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": shown ? "public, max-age=31536000, s-maxage=31536000, immutable" : "private, max-age=3600",
    },
  });
}
