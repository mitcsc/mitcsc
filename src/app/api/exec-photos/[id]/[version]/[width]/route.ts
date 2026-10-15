import { EXEC_PHOTO_WIDTHS } from "@/lib/exec-roster";
import { execPhotoLibrary, isRosterPhoto } from "@/lib/exec";
import { hasExecAccess, signedInEmail } from "@/lib/membership/exec-auth";
import { publicMessage } from "@/lib/membership/errors";
import { imageThumbnail } from "@/lib/membership/google/drive";

export const runtime = "nodejs";
export const maxDuration = 60;

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

// Serves an exec photo from Drive, resized by Google to one of EXEC_PHOTO_WIDTHS.
// Photos on /exec or /alumni are public and cached for a year. The version in the URL changes with the file,
// so a replaced photo gets a new URL. Other photos in the folder are for exec only, for the dashboard.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; version: string; width: string }> }) {
  const { id, width } = await params;
  const size = Number(width);
  if (!EXEC_PHOTO_WIDTHS.includes(size)) return notFound();
  const shown = await isRosterPhoto(id);
  if (!shown) {
    const library = await execPhotoLibrary();
    const email = await signedInEmail();
    if (!library?.photos.some((p) => p.id === id) || !email || !(await hasExecAccess(email))) return notFound();
  }
  let image: Awaited<ReturnType<typeof imageThumbnail>>;
  try {
    image = await imageThumbnail(id, size);
  } catch (error) {
    console.error(JSON.stringify({ event: "exec_photo_error", message: publicMessage(error, "Drive could not load this photo.") }));
    return new Response("This photo could not be loaded.", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.type,
      "Cache-Control": shown ? "public, max-age=31536000, s-maxage=31536000, immutable" : "private, max-age=31536000, immutable",
    },
  });
}
