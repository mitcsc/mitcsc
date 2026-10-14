import DelibsRoom from "@/components/voting/DelibsRoom";
import { VotingToaster } from "@/components/voting/VotingNotice";
import "./voting.css";
import "./mockup.css";
import "./join.css";
import "./voter.css";
import "./admin.css";
import "./delibs.css";

export default function DelibsPage() {
  return <main className="voting-root d-delibs"><DelibsRoom/><VotingToaster/></main>;
}
