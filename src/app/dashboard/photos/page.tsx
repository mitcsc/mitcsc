import LiveData from "@/components/dashboard/LiveData";
import PhotoLibraryView from "@/components/dashboard/PhotoLibrary";
import { PHOTO_FOLDER_PATH, photoLibrary, refreshPhotoLibrary, shownPhotoIds } from "@/lib/home-photos";
import { publicMessage } from "@/lib/membership/errors";
import { folderUrl } from "@/lib/membership/google/drive";

// A list this fresh is reused, so switching tabs back and forth does not list Drive each time.
const REUSE_MS = 60_000;

export default async function PhotosPage() {
  let problem: string | null = null;
  // Lists Drive on visits, so new photos show up without a refresh button.
  const saved = await photoLibrary();
  const library = saved && Date.now() - saved.checkedAt < REUSE_MS ? saved : await refreshPhotoLibrary().catch((error) => {
    problem = publicMessage(error, "Could not read the Drive folder.");
    return saved;
  });
  const shown = await shownPhotoIds();
  return (
    <>
      <LiveData renderedAt={Date.now()} />
      <PhotoLibraryView
        photos={library?.photos || []}
        // Drive's thumbnail links expire, so an old saved list falls back to /api/home-photos.
        thumbnails={problem ? {} : library?.thumbnails || {}}
        shown={shown}
        folder={library?.folderId ? folderUrl(library.folderId) : null}
        folderPath={PHOTO_FOLDER_PATH}
        problem={problem}
      />
    </>
  );
}
