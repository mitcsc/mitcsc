import { redisEnabled } from "./redis";
import { presidentEnabled } from "./president";
import { redisSettings, redisState, redisAdminAction, redisSubmit, redisRecoverBallot } from "./redis-service";
import { Identity, VotingError, text } from "./security";
import type { Candidate, Criterion, Ratings } from "./types";

export const HEADERS = {
  Candidates: ["id", "name", "context", "order", "completed"],
  Criteria: ["id", "label", "description", "min", "max", "required"],
  Responses: ["submission_id", "session_id", "candidate_id", "candidate_name", "voter_id", "voter_name", "ballot_version", "criterion_id", "criterion_label", "initial_rating", "final_rating", "submitted_at"],
  Session: ["key", "value"],
  Ballots: ["candidate_id", "ballot_version", "candidate_name", "candidate_context", "criteria_json"],
  Summary: ["session_id", "candidate_id", "candidate_name", "criterion", "initial_average", "final_average", "ratings_count"],
};
export interface Settings { sessionId: string; password: string; sheetId: string; settingsSheetId: string; name?: string; presidentManaged?: boolean }
export function authorize(identity: Identity | null, config: Settings, admin = false): Identity {
  if (!identity || identity.sessionId !== config.sessionId || identity.sheetId !== config.sheetId) throw new VotingError("Enter the session password to join.", 401);
  if (admin && identity.role !== "admin") throw new VotingError("Admin access required.", 403);
  return identity;
}
export function validateSetup(candidates: Candidate[], criteria: Criterion[]) {
  if (!Array.isArray(candidates) || candidates.length > 100 || !Array.isArray(criteria) || criteria.length > 20) throw new VotingError("Use at most 100 candidates and 20 criteria.");
  for (const c of candidates) {
    if (!c || typeof c !== "object") throw new VotingError("Invalid candidate details.");
    text(c.id, "candidate ID", 100);
    if (["__proto__", "constructor", "prototype"].includes(c.id)) throw new VotingError("Invalid candidate ID."); text(c.name, "candidate name", 150);
    if (typeof c.context !== "string" || c.context.length > 5000 || !Number.isFinite(c.order) || typeof c.completed !== "boolean") throw new VotingError("Invalid candidate details.");
  }
  for (const c of criteria) {
    if (!c || typeof c !== "object") throw new VotingError("Invalid criterion details.");
    text(c.id, "criterion ID", 100); text(c.label, "criterion label", 150);
    if (typeof c.description !== "string" || c.description.length > 1000 || !Number.isInteger(c.min) || !Number.isInteger(c.max) || c.min < -100 || c.max > 100 || c.max <= c.min || c.max - c.min > 20 || typeof c.required !== "boolean") throw new VotingError("Criteria need integer scales with 2–21 options and valid descriptions.");
  }
  if (new Set(candidates.map(c => c.id)).size !== candidates.length || new Set(criteria.map(c => c.id)).size !== criteria.length) throw new VotingError("Candidate and criterion IDs must be unique.");
}
export function validateRatings(value: unknown, criteria: Criterion[]): asserts value is Ratings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new VotingError("Invalid ratings.");
  const ratings = value as Ratings;
  if (Object.keys(ratings).some(key => !criteria.some(c => c.id === key))) throw new VotingError("Ratings do not match this ballot.");
  for (const c of criteria) {
    const rating = ratings[c.id];
    if ((rating === null || rating === undefined) && !c.required) continue;
    if (!Number.isInteger(rating) || rating! < c.min || rating! > c.max) throw new VotingError(`Choose a valid rating for ${c.label}.`);
  }
}

export async function settings(): Promise<Settings> {
  if (!presidentEnabled() || !redisEnabled()) throw new VotingError("Configure the president password and Redis before opening voting.", 503);
  return redisSettings();
}
export const getState = redisState;
export const adminAction = redisAdminAction;
export async function submitInitial(config: Settings, identity: Identity, input: Record<string, unknown>) {return redisSubmit(config, identity, input, true);}
export async function submit(config: Settings, identity: Identity, input: Record<string, unknown>) {return redisSubmit(config, identity, input, false);}
export const recoverBallot = redisRecoverBallot;
