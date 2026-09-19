export type VotingPhase = "waiting" | "initial" | "deliberation" | "revision" | "final" | "locked";
export interface Candidate { id: string; name: string; context: string; order: number; completed: boolean }
export interface Criterion { id: string; label: string; description: string; min: number; max: number; required: boolean }
export type Ratings = Record<string, number | null>;
export interface VotingState {
  sessionId: string;
  active: boolean;
  phase: VotingPhase;
  votingStarted?: boolean;
  votingComplete?: boolean;
  ballotVersion: string;
  currentCandidate: Candidate | null;
  criteria: Criterion[];
  contextVisible: boolean;
  submittedCount: number;
  voter: { id: string; name: string } | null;
  isAdmin: boolean;
  initialized: boolean;
  exportPending?: boolean;
  ownBallot?: {initialSubmitted: boolean; submitted: boolean};
  eligible?: boolean;
  admissionPending?: boolean;
  pollIntervalMs?: number;
  voters?: {id: string; name: string; removed: boolean; banned?: boolean; presence?: "online" | "away" | "offline" | "unknown"; eligible: boolean}[];
  participants?: { id: string; name: string; submitted: boolean; initialSubmitted?: boolean }[];
  candidateStates?: {candidateId: string; phase: VotingPhase; ballotVersion: string; submittedCount: number; participants: NonNullable<VotingState["participants"]>}[];
  candidates?: Candidate[];
  spreadsheetUrl?: string;
}
export interface FinalBallot {
  submissionId: string;
  sessionId: string;
  candidateId: string;
  ballotVersion: string;
  initialRatings: Ratings;
  finalRatings: Ratings;
}
export type AdminAction =
  | { action: "removeVoters" | "banVoters" | "admitVoters"; voterIds: string[] }
  | { action: "removeVoter" | "admitVoter"; voterId: string }
  | { action: "initialize" }
  | { action: "saveSetup"; candidates: Candidate[]; criteria: Criterion[] }
  | { action: "setPhase"; phase: VotingPhase; candidateId?: string }
  | { action: "setContext"; visible: boolean };

export interface RecoveredBallot { initialRatings: Ratings | null; finalRatings: Ratings | null; submissionId: string | null }
