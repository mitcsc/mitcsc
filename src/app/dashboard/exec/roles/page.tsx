import LiveData from "@/components/dashboard/LiveData";
import RolesView from "@/components/dashboard/RolesView";
import { execRoster } from "@/lib/exec";
import { publicMessage } from "@/lib/membership/errors";

export const maxDuration = 60;

export default async function RolesPage() {
  try {
    const roster = await execRoster();
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
