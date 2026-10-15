import CopyRoster from "@/components/dashboard/CopyRoster";
import LiveData from "@/components/dashboard/LiveData";
import RolesView from "@/components/dashboard/RolesView";
import { execRoster } from "@/lib/exec";
import { localMode } from "@/lib/local-mode";
import { publicMessage } from "@/lib/membership/errors";

export const maxDuration = 60;

export default async function RolesPage() {
  try {
    const roster = await execRoster();
    if (!roster) return <CopyRoster local={localMode()} />;
    const holders = Object.fromEntries(roster.roles.map((role) => [role, roster.current.filter((p) => p.position === role).map((p) => p.name)]));
    return (
      <>
        <LiveData renderedAt={Date.now()} />
        <RolesView roles={roster.roles} holders={holders} />
      </>
    );
  } catch (error) {
    return <main className="d-page"><p className="m-error" role="alert">{publicMessage(error, "Could not load the roles. Please try again.")}</p></main>;
  }
}
