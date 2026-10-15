import ExecRosterView from "@/components/dashboard/ExecRosterView";
import LiveData from "@/components/dashboard/LiveData";
import { execPhotoLibrary, execRoster, type RosterList } from "@/lib/exec";
import { localMode } from "@/lib/local-mode";
import { publicMessage } from "@/lib/membership/errors";

// After this long, opening the photo picker checks Drive for new photos.
const REUSE_MS = 60_000;
// Drive's signed thumbnail links last a few hours. After this, the picker loads photos through the site instead.
const THUMBNAILS_MS = 3600_000;

// The Current and Alumni tabs.
export default async function RosterPage({ list }: { list: RosterList }) {
  try {
    const [roster, library] = await Promise.all([execRoster(), execPhotoLibrary()]);
    const age = library ? Date.now() - library.checkedAt : Infinity;
    return (
      <>
        <LiveData renderedAt={Date.now()} />
        <ExecRosterView
          list={list}
          people={roster[list]}
          roles={roster.roles}
          photos={library?.photos || []}
          thumbnails={age < THUMBNAILS_MS ? library?.thumbnails || {} : {}}
          checkDrive={!localMode() && age >= REUSE_MS}
          local={localMode()}
        />
      </>
    );
  } catch (error) {
    return <main className="d-page"><p className="m-error" role="alert">{publicMessage(error, "Could not load the exec. Please try again.")}</p></main>;
  }
}
