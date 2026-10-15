import RosterPage from "./load";

// Copying the exec in uploads every photo to Drive, which takes a while.
export const maxDuration = 60;

export default function CurrentExecPage() {
  return <RosterPage list="current" />;
}
