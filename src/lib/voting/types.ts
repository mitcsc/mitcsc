export type VotingPhase = "waiting" | "initial" | "deliberation" | "revision" | "final" | "locked";
export interface Candidate { id: string; name: string; context: string; order: number; completed: boolean }
export interface Criterion { id: string; label: string; description: string; min: number; max: number; required: boolean }
export type Ratings = Record<string, number | null>;
export interface VotingState {
  sessionId: string;
  active: boolean;
  phase: VotingPhase;
  ballotVersion: string;
  currentCandidate: Candidate | null;
  criteria: Criterion[];
  contextVisible: boolean;
  submittedCount: number;
  voter: { id: string; name: string } | null;
  isAdmin: boolean;
  initialized: boolean;
  participants?: { id: string; name: string; submitted: boolean }[];
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
  | { action: "initialize" }
  | { action: "saveSetup"; candidates: Candidate[]; criteria: Criterion[] }
  | { action: "shuffle" }
  | { action: "setPhase"; phase: VotingPhase; candidateId?: string }
  | { action: "setContext"; visible: boolean };
