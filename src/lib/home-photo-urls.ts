// Safe to import from client components. The server side is in home-photos.ts.

export interface HomePhoto {
  id: string;
  name: string;
  version: string;
  createdAt: number;
}

// Widths /api/home-photos serves. The home page srcset and the dashboard pick from these.
export const PHOTO_WIDTHS = [128, 256, 384, 512, 640, 828, 1080];

// The version in the path changes when the file changes in Drive, so each URL can be cached for good.
export function photoUrl(photo: Pick<HomePhoto, "id" | "version">, width: number) {
  return `/api/home-photos/${encodeURIComponent(photo.id)}/${encodeURIComponent(photo.version)}/${width}`;
}
