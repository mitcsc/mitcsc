import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { PHOTO_WIDTHS } from "@/lib/home-photo-urls";
import { clearPhotoFailure, HOME_PHOTOS_TAG, isPhotoShown, photoLibrary, recordPhotoFailure, refreshPhotoLibrary } from "@/lib/home-photos";
import { hasExecAccess, signedInEmail } from "@/lib/membership/exec-auth";
import { publicMessage } from "@/lib/membership/errors";
import { GoogleApiError } from "@/lib/membership/google/api";
import { imageThumbnail } from "@/lib/membership/google/drive";

export const runtime = "nodejs";
export const maxDuration = 60;

// When Drive no longer has a photo, the folder is listed again, but at most this often.
const RELIST_GAP_MS = 60_000;

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

// Serves a home page photo from Drive, resized by Google to one of PHOTO_WIDTHS.
// Photos that are on the home page are public and cached for a year, so Drive sees each size about once.
// Others are for exec only, for the dashboard.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; version: string; width: string }> }) {
  const { id, version, width } = await params;
  const size = Number(width);
  if (!PHOTO_WIDTHS.includes(size)) return notFound();
  const library = await photoLibrary();
  if (!library?.photos.some((p) => p.id === id && p.version === version)) return notFound();
  const shown = await isPhotoShown(id);
  if (!shown) {
    const email = await signedInEmail();
    if (!email || !(await hasExecAccess(email))) return notFound();
  }
  let image: Awaited<ReturnType<typeof imageThumbnail>>;
  try {
    image = await imageThumbnail(id, size);
  } catch (error) {
    const message = publicMessage(error, "Drive could not load this photo.");
    console.error(JSON.stringify({ event: "home_photo_error", message }));
    // The dashboard flags the photo. If Drive no longer has it, listing the folder again takes it off the home page.
    after(async () => {
      await recordPhotoFailure(id, { version, message, at: Date.now() });
      if (error instanceof GoogleApiError && error.googleStatus === 404 && Date.now() - library.checkedAt > RELIST_GAP_MS) {
        await refreshPhotoLibrary();
        revalidateTag(HOME_PHOTOS_TAG);
      }
    });
    return new Response("This photo could not be loaded.", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  after(() => clearPhotoFailure(id));
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.type,
      "Cache-Control": shown ? "public, max-age=31536000, s-maxage=31536000, immutable" : "private, max-age=31536000, immutable",
    },
  });
}
