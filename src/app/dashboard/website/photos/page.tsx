import LiveData from "@/components/dashboard/LiveData";
import PhotoLibraryView from "@/components/dashboard/PhotoLibrary";
import { PHOTO_FOLDER_PATH, photoFailures, photoLibrary, shownPhotoIds } from "@/lib/home-photos";
import { folderUrl } from "@/lib/membership/google/drive";

// A list this fresh is reused, so switching tabs back and forth does not list Drive each time.
const REUSE_MS = 60_000;
// Drive's thumbnail links expire after a few hours, so older ones are not used.
const THUMBNAILS_MS = 60 * 60_000;

// Shows the saved list right away. When it is older than REUSE_MS, the page lists Drive in the
// background and reloads with the new list, so new photos show up without a refresh button.
export default async function PhotosPage() {
  const library = await photoLibrary();
  const [shown, failures] = await Promise.all([shownPhotoIds(), photoFailures(library?.photos || [])]);
  const age = library ? Date.now() - library.checkedAt : Infinity;
  return (
    <>
      <LiveData renderedAt={Date.now()} />
      <PhotoLibraryView
        photos={library?.photos || []}
        // Without fresh Drive links, the previews come from /api/home-photos.
        thumbnails={age < THUMBNAILS_MS ? library?.thumbnails || {} : {}}
        failures={Object.fromEntries(Object.entries(failures).map(([id, f]) => [id, f.message]))}
        missing={library?.missing || []}
        shown={shown}
        folder={library?.folderId ? folderUrl(library.folderId) : null}
        folderPath={PHOTO_FOLDER_PATH}
        checkDrive={age >= REUSE_MS}
      />
    </>
  );
}
