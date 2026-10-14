import LiveData from "@/components/dashboard/LiveData";
import PhotoLibraryView from "@/components/dashboard/PhotoLibrary";
import { PHOTO_FOLDER_PATH, photoLibrary, refreshPhotoLibrary, shownPhotoIds } from "@/lib/home-photos";
import { publicMessage } from "@/lib/membership/errors";
import { folderUrl } from "@/lib/membership/google/drive";

export default async function PhotosPage() {
  let problem: string | null = null;
  // Lists Drive on every visit, so new photos show up without a refresh button.
  const library = await refreshPhotoLibrary().catch(async (error) => {
    problem = publicMessage(error, "Could not read the Drive folder.");
    return photoLibrary();
  });
  const shown = await shownPhotoIds();
  return (
    <>
      <LiveData renderedAt={Date.now()} />
      <PhotoLibraryView
        photos={library?.photos || []}
        shown={shown}
        folder={library?.folderId ? folderUrl(library.folderId) : null}
        folderPath={PHOTO_FOLDER_PATH}
        problem={problem}
      />
    </>
  );
}
