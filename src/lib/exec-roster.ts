// Safe to import from client components. The server side is in exec.ts.
import { PHOTO_WIDTHS } from "./home-photo-urls";

export interface ExecPhoto {
  id: string;
  // Changes whenever the file changes in Drive, so each photo URL can be cached for good.
  version: string;
  name: string;
  // A tiny copy of the photo as a data URL, shown blurred until the photo loads.
  placeholder?: string;
}

export interface ExecPerson {
  id: string;
  name: string;
  position: string;
  classYear: string;
  hometown: string;
  photo: ExecPhoto | null;
  // Set when someone moves from current exec to alumni: their place in current exec then, and when.
  // People moved one at a time keep their current exec order at the top of alumni.
  moved?: { from: number; at: number };
}

export type RosterList = "current" | "alumni";

export interface ExecRoster {
  current: ExecPerson[];
  alumni: ExecPerson[];
  // The positions exec pick from, in the club's order. An alumnus may keep a position no longer listed.
  roles: string[];
}

export interface PersonInput {
  name: string;
  position: string;
  classYear: string;
  hometown: string;
  photoId: string | null;
}

export const EXEC_PHOTO_WIDTHS = PHOTO_WIDTHS;

export function execPhotoUrl(photo: Pick<ExecPhoto, "id" | "version">, width: number) {
  return `/api/exec-photos/${encodeURIComponent(photo.id)}/${encodeURIComponent(photo.version)}/${width}`;
}
