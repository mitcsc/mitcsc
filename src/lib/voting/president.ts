import { createHmac } from "node:crypto";
import { equal, readIdentity, signIdentity, VotingError } from "./security";

export const PRESIDENT_COOKIE = "csc_voting_president";
export function presidentEnabled() { return !!process.env.VOTING_PRESIDENT_PASSWORD; }
function fingerprint() {
  const password = process.env.VOTING_PRESIDENT_PASSWORD;
  if (!password || password.length < 8) throw new VotingError("Set VOTING_PRESIDENT_PASSWORD to at least 8 characters.", 503);
  return createHmac("sha256", password).update("csc-president-session-v1").digest("hex");
}
export function presidentLogin(password: string) {
  const claimId = fingerprint();
  if (!equal(password, process.env.VOTING_PRESIDENT_PASSWORD!)) throw new VotingError("Incorrect password.", 401);
  return signIdentity({id: "president", name: "President", role: "admin", sessionId: "president", sheetId: "president", claimId}, {purpose: "president"});
}
export function requirePresident(token?: string) {
  const identity = readIdentity(token, "president");
  if (!identity || !equal(identity.claimId || "", fingerprint())) throw new VotingError("Enter the president password.", 401);
}
