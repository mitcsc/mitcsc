import DelibsRoom from "@/components/voting/DelibsRoom";
import { VotingToaster } from "@/components/voting/VotingNotice";

export default function DelibsPage() {
  return <main className="voting-root d-delibs"><DelibsRoom/><VotingToaster/></main>;
}
