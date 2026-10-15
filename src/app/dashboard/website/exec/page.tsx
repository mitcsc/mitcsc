import RosterPage from "./load";

// Opening the photo picker can list Drive and upload a photo, which takes a while.
export const maxDuration = 60;

export default function CurrentExecPage() {
  return <RosterPage list="current" />;
}
