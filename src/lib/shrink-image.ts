// Shrinks a photo in the browser before upload: at most 2000 px on the long side, as a JPEG.
// That keeps it far under the server's request size limit, and Drive and the site only need 1080 px.
// A file the browser cannot read (HEIC in Chrome, for example) goes up as it is if it is small enough,
// because Google can still make resized copies of it.
const MAX_SIDE = 2000;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function shrinkImage(file: File, baseName: string): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (file.size <= MAX_UPLOAD_BYTES) return file;
    throw new Error("This photo can’t be read here. Pick a JPG or PNG under 4 MB.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!blob) throw new Error("This photo could not be prepared. Try another one.");
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
}
