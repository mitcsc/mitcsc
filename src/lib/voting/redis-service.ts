import { createHash, randomUUID } from "node:crypto";
import { compareAndSet, redisCommand, redisKey, releaseLock } from "./redis";
import { summarizeRatings } from "./results";
import { Identity, text, VotingError } from "./security";
import { authorize, validateRatings, validateSetup } from "./service";
import type { Settings } from "./service";
import type { Candidate, Criterion, Ratings, VotingPhase, VotingState } from "./types";

// A signed-in exec, from the dashboard session.
export interface Person { email: string; name: string }

type Member = {banned?: boolean; rejoinRequested?: boolean; pending?: boolean; removed?: boolean; id: string; email: string; name: string; role: "admin" | "voter"; slot: number};
type Vote = {id: string; initial: Ratings; final: Ratings; at: string};
type Round = {version: string; initial: Record<string, string>; initialRatings?: Record<string, Ratings>; roster?: string[]; votes: Record<string, Vote>};
interface Election {
  schema: 2;
  revision: number;
  ended?: boolean;
  candidates: Candidate[];
  criteria: Criterion[];
  members: Member[];
  roster?: string[];
  phase: VotingPhase;
  current: string;
  rounds: Record<string, Round>;
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const keyFor = (config: Pick<Settings, "sessionId">) => redisKey("delib", config.sessionId);
const activeElectionKey = () => redisKey("delibs-active");
// Every delib ever created, by session ID, so a host can read results after ending it.
const historyKey = () => redisKey("delibs-history");

// The same exec always gets the same ID in a delib, on any device. It never reveals the email.
export function memberId(sessionId: string, email: string) {
  return createHash("sha256").update(JSON.stringify(["delib-member", sessionId, email])).digest("hex").slice(0, 32);
}
export function identityFor(config: Settings, person: Person): Identity {
  return {id: memberId(config.sessionId, person.email), name: person.name, role: person.email === config.host ? "admin" : "voter", sessionId: config.sessionId};
}

export async function redisSettings(): Promise<Settings> {
  const config = await currentElection();
  if (!config?.open) throw new VotingError("No delib is open.", 404);
  return config;
}

async function load(config: Settings): Promise<{raw: string; doc: Election}> {
  const raw = await redisCommand<string | null>("GET", keyFor(config));
  if (!raw) throw new VotingError("Delib data is missing. Restore Redis before continuing.", 503);
  const doc = JSON.parse(raw) as Election;
  if (doc.schema !== 2) throw new VotingError("This deployment cannot read the saved delib.", 503);
  return {raw, doc};
}

async function change<T>(config: Settings, operation: (doc: Election) => T): Promise<T> {
  // Optimistic transactions apply the entire operation to one authoritative revision.
  // Retrying a conflict cannot overwrite another voter's acknowledgement or a phase change.
  const deadline = Date.now() + 25_000;
  for (let attempt = 0; attempt < 60 && Date.now() < deadline; attempt++) {
    const {raw, doc} = await load(config);
    const result = operation(doc);
    if (JSON.stringify(doc) === raw) return result;
    doc.revision++;
    const next = JSON.stringify(doc);
    if (Buffer.byteLength(next) > 8_000_000) throw new VotingError("This delib has reached its storage limit. Existing votes are safe.", 409);
    if (await compareAndSet(keyFor(config), raw, next, publicDocument(doc))) return result;
    await delay(20 + Math.random() * Math.min(600, (attempt + 1) * 40));
  }
  throw new VotingError("Voting is busy. Please retry.", 503, 2);
}
function member(doc: Election, identity: Identity, admin = false) {
  const found = doc.members.find(m => m.id === identity.id);
  if (found?.banned) throw new VotingError("You are banned from this session.", 401);
  if (found?.removed) throw new VotingError("You were kicked from this session. You can join again.", 401);
  if (!found || (admin && found.role !== "admin")) throw new VotingError(admin ? "Only the host can do that." : "Join the session.", admin ? 403 : 401);
  return found;
}

// Adds a signed-in exec to the open delib as a voter, or lets a kicked voter back in.
// The club account is shared, so it can host but not vote.
export async function redisJoin(config: Settings, person: Person, clubEmail: string) {
  const identity = identityFor(config, person);
  if (identity.role === "admin") return identity;
  if (person.email === clubEmail) throw new VotingError("The club account cannot vote. Sign in with your own Google account.", 403);
  return change<Identity>(config, doc => {
    if (doc.ended) throw new VotingError("This delib has ended.", 409);
    const known = doc.members.find(m => m.id === identity.id);
    if (known?.banned) throw new VotingError("You are banned from this session.", 403);
    if (known) {
      if (known.removed) { known.removed = false; known.pending = Object.keys(doc.rounds).length > 0; known.rejoinRequested = false; }
      known.name = person.name;
      return identity;
    }
    if (doc.members.length >= 129) throw new VotingError("This session has reached its 128-voter limit.", 409);
    doc.members.push({pending: Object.keys(doc.rounds).length > 0, id: identity.id, email: person.email, name: person.name, role: "voter", slot: doc.members.length - 1});
    return identity;
  });
}
export async function redisVoters(config: Settings) {
  return (await readView(config)).members.filter(m => m.role === "voter").map(m => ({id: m.id, name: m.name}));
}
function present(config: Settings, identity: Identity, doc: Election): VotingState {
  const m = member(doc, identity);
  const admin = m.role === "admin";
  const liveRound = doc.rounds[doc.current];
  const eligible = !m.pending && (!liveRound || !(liveRound.roster || doc.roster) || (liveRound.roster || doc.roster)!.includes(m.id));
  if (!admin && !eligible) return {pollIntervalMs: 3000, sessionId: config.sessionId, active: !doc.ended, phase: "waiting", votingStarted: true, ballotVersion: "", currentCandidate: null, criteria: [], contextVisible: false, submittedCount: 0, voter: {id: m.id, name: m.name}, isAdmin: false, eligible: false, admissionPending: !!m.pending};
  const current = doc.candidates.find(c => c.id === doc.current) || null;
  const round = doc.rounds[doc.current];
  const counted = (r?: Round) => Object.keys(r?.votes || {}).filter(id=>!doc.members.find(m=>m.id===id)?.banned).length;
  const participants = (r?: Round) => doc.members.filter(m => m.role === "voter" && !m.removed && !m.pending && (!(r?.roster || doc.roster) || (r?.roster || doc.roster)!.includes(m.id))).map(m => ({id: m.id, name: m.name, submitted: !!r?.votes[m.id], initialSubmitted: !!r?.initial[m.id]}));
  const complete = doc.phase === "locked" && doc.candidates.length > 0 && doc.candidates.every(c=>c.completed);
  const unfinished = Object.values(doc.rounds).some(r => r.initial[m.id] && !r.votes[m.id]);
  return {pollIntervalMs: !admin && complete && !unfinished ? 10000 : 3000, sessionId: config.sessionId, active: config.open && !doc.ended, votingComplete: complete, phase: doc.phase, votingStarted: Object.keys(doc.rounds).length > 0, ballotVersion: round?.version || "", currentCandidate: current && {...current, context: current.context}, criteria: doc.criteria, contextVisible: !!current?.context, submittedCount: counted(round), voter: {id: m.id, name: m.name}, isAdmin: admin, ownBallot: {initialSubmitted: !!round?.initial[m.id], submitted: !!round?.votes[m.id]}, eligible: admin || !round || !(round.roster || doc.roster) || (round.roster || doc.roster)!.includes(m.id),
    ...(admin ? {voters: doc.members.filter(v => v.role === "voter").map(v => ({id: v.id, name: v.name, removed: !!v.removed, banned: !!v.banned, eligible: !v.pending && (!round || !!(round.roster || doc.roster)?.includes(v.id))})), candidates: doc.candidates, participants: participants(round), candidateStates: doc.candidates.map(c => ({candidateId: c.id, phase: c.id === doc.current ? doc.phase : c.completed ? "locked" : "waiting", ballotVersion: doc.rounds[c.id]?.version || "", submittedCount: counted(doc.rounds[c.id]), participants: participants(doc.rounds[c.id])}))} : {})};
}
// Polling reads the small public projection, never the private ballots.
export async function redisState(config: Settings, identity: Identity) { return present(config, identity, await readView(config)); }

export async function redisSubmit(config: Settings, identity: Identity, input: Record<string, unknown>, initial: boolean) {
  const at = new Date().toISOString();
  return change(config, doc => {
    const m = member(doc, identity);
    if (m.pending) throw new VotingError("Wait for the host to admit you.", 403);
    if (m.role === "admin") throw new VotingError("The host does not vote.", 403);
    if (input.sessionId !== config.sessionId) throw new VotingError("This ballot belongs to another session.", 409);
    const candidateId = text(input.candidateId, "candidate ID", 100);
    const r = Object.hasOwn(doc.rounds, candidateId) ? doc.rounds[candidateId] : undefined;
    if (!r || r.version !== input.ballotVersion) throw new VotingError("This ballot is no longer current.", 409);
    // A lost acknowledgement remains recoverable after closing or switching candidates.
    if (initial && r.initial[m.id]) return {ok: true};
    if (!initial && r.votes[m.id]) return {ok: true, submissionId: r.votes[m.id].id};
    if (doc.ended || !config.open || candidateId !== doc.current || !(initial ? ["initial"] : ["revision", "final"]).includes(doc.phase)) throw new VotingError(initial ? "Initial ratings have closed for this candidate." : "Final submissions are not currently open.", 409);
    if (!(r.roster || doc.roster)?.includes(m.id)) throw new VotingError("You are not admitted for this candidate. Ask the host during initial ratings, or wait for the next candidate.", 409);
    if (initial) {
      validateRatings(input.ratings, doc.criteria);
      r.initial[m.id] = at;
      (r.initialRatings ||= {})[m.id] = input.ratings;
      return {ok: true};
    }
    if (!r.initial[m.id]) throw new VotingError("Initial ratings were not submitted for this candidate.", 409);
    const id = text(input.submissionId, "submission ID", 100);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new VotingError("Invalid submission ID.");
    validateRatings(input.initialRatings, doc.criteria); validateRatings(input.finalRatings, doc.criteria);
    r.votes[m.id] = {id, initial: r.initialRatings?.[m.id] || input.initialRatings, final: input.finalRatings, at};
    return {ok: true, submissionId: id};
  });
}

export async function redisAdminAction(config: Settings, identity: Identity, input: Record<string, unknown>) {
  const version = randomUUID();
  await change(config, doc => {
    member(doc, identity, true);
    if (doc.ended) throw new VotingError("This delib has ended.", 409);
    if (input.action === "removeVoters" || input.action === "banVoters" || input.action === "admitVoters") {
      if (!Array.isArray(input.voterIds) || !input.voterIds.length || input.voterIds.length > 128 || input.voterIds.some(id => typeof id !== "string")) throw new VotingError("Select voters first.");
      const selected = input.voterIds.map(id => doc.members.find(v => v.id === id && v.role === "voter"));
      if (selected.some(v => !v)) throw new VotingError("One of the selected voters was not found.", 404);
      if (input.action === "removeVoters" || input.action === "banVoters") {
        for (const voter of selected) { voter!.removed = true; voter!.rejoinRequested = false; if (input.action === "banVoters") voter!.banned = true; }
      } else {
        if (selected.some(v => v!.banned)) throw new VotingError("Banned voters cannot be admitted to this session.", 409);
        const round = doc.rounds[doc.current];
        if (round && doc.phase !== "initial") throw new VotingError("Admit voters during initial ratings or before the next candidate starts.", 409);
        for (const voter of selected) {
          voter!.removed = false; voter!.pending = false; voter!.rejoinRequested = false;
          if (round) {
            round.roster ||= [...(doc.roster || [])];
            if (!round.roster.includes(voter!.id)) round.roster.push(voter!.id);
          }
        }
      }
      return;
    }
    if (input.action !== "setPhase") throw new VotingError("Unknown host action.");
    if (input.expected) {
      const expected = input.expected as {candidateId?: string; version?: string; phase?: string};
      if (expected.candidateId !== doc.current || expected.version !== (doc.rounds[doc.current]?.version || "") || expected.phase !== doc.phase) throw new VotingError("The session changed. Refresh before continuing.", 409);
    }
    const next = input.phase as VotingPhase;
    const idle = ["waiting", "locked"].includes(doc.phase);
    const selected = doc.candidates.find(c => c.id === (input.candidateId || doc.current));
    if (next === "waiting" && idle && input.candidateId) {
      if (!selected || selected.completed) throw new VotingError("Choose an unfinished candidate.", 409);
      doc.current = selected.id; doc.phase = "waiting"; return;
    }
    if (next === "initial" && idle) {
      if (!config.open) throw new VotingError("The session is closed.", 409);
      if (!selected || selected.completed || doc.rounds[selected.id]) throw new VotingError("Choose an unfinished candidate.", 409);
      validateSetup(doc.candidates, doc.criteria);
      if (!doc.criteria.length) throw new VotingError("Add at least one criterion.");
      doc.roster ||= doc.members.filter(m => m.role === "voter" && !m.removed && !m.pending).map(m => m.id);
      doc.rounds[selected.id] = {version, initial: {}, initialRatings: {}, roster: doc.members.filter(m => m.role === "voter" && !m.removed && !m.pending).map(m => m.id), votes: {}};
      doc.current = selected.id; doc.phase = "initial"; return;
    }
    if (next === "final" && idle && input.candidateId) {
      if (!selected || !doc.rounds[selected.id]) throw new VotingError("That candidate has no ballot to reopen.", 409);
      doc.current = selected.id; doc.phase = "final"; return;
    }
    const allowed: Record<VotingPhase, VotingPhase[]> = {waiting: [], initial: ["deliberation", "revision", "final", "locked"], deliberation: ["revision", "final", "locked"], revision: ["deliberation", "final", "locked"], final: ["locked"], locked: []};
    if (next === doc.phase) return;
    if (!allowed[doc.phase].includes(next)) throw new VotingError("That phase change is not available.", 409);
    doc.phase = next;
    if (next === "locked") doc.candidates.find(c => c.id === doc.current)!.completed = true;
  });
  return redisState(config, identity);
}

function publicDocument(doc: Election) {
  // Polling reads this small projection. Ratings stay only in the private Redis document.
  return JSON.stringify({...doc, rounds: Object.fromEntries(Object.entries(doc.rounds).map(([id, r]) => [id, {...r, initialRatings: undefined, initial: Object.fromEntries(Object.keys(r.initial).map(id => [id, true])), votes: Object.fromEntries(Object.keys(r.votes).map(id => [id, true]))}]))});
}
async function readView(config: Settings): Promise<Election> {
  const raw = await redisCommand<string | null>("GET", `${keyFor(config)}:view`);
  if (raw) return JSON.parse(raw) as Election;
  return (await load(config)).doc;
}

export async function redisRecoverBallot(config: Settings, identity: Identity, candidateId: string, version: string) {
  const {doc} = await load(config);
  const m = member(doc, identity);
  if (m.pending) throw new VotingError("Wait for the host to admit you.", 403);
  if (m.role !== "voter") throw new VotingError("The host does not vote.", 403);
  const round = Object.hasOwn(doc.rounds, candidateId) ? doc.rounds[candidateId] : undefined;
  if (!round || round.version !== version) throw new VotingError("This ballot is no longer available.", 409);
  const vote = round.votes[m.id];
  return {initialRatings: round.initialRatings?.[m.id] || vote?.initial || null, finalRatings: vote?.final || null, submissionId: vote?.id || null};
}

export async function currentElection(): Promise<Settings | null> {
  const raw = await redisCommand<string | null>("GET", activeElectionKey());
  return raw ? JSON.parse(raw) as Settings : null;
}

// Opens a new delib hosted by `host`. Retrying with the same request ID returns the same delib.
export async function createElection(input: Record<string, unknown>, host: Person) {
  const sessionId = text(input.requestId, "request ID", 36);
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) throw new VotingError("Invalid request ID.");
  const name = input.name ? text(input.name, "delib name", 100) : `Delibs ${new Date().toISOString().slice(0, 10)}`;
  const candidates = (input.candidates || []) as Candidate[];
  const criteria = (input.criteria || []) as Criterion[];
  validateSetup(candidates, criteria);
  if (!candidates.length || !criteria.length) throw new VotingError("Add candidates and criteria before opening the session.");
  const owner = randomUUID(), lock = `${activeElectionKey()}:lock`;
  if (!await redisCommand("SET", lock, owner, "NX", "EX", 30)) throw new VotingError("Delib setup is busy. Retry shortly.", 503, 2);
  try {
    const active = await currentElection();
    if (active?.sessionId === sessionId) return active;
    if (active?.open) throw new VotingError(`${active.hostName} is already running “${active.name}”. They need to end it first.`, 409);
    const config: Settings = {sessionId, name, host: host.email, hostName: host.name, open: true, createdAt: Date.now()};
    const admin: Member = {id: memberId(sessionId, host.email), email: host.email, name: host.name, role: "admin", slot: -1};
    const doc: Election = {schema: 2, revision: 0, candidates: candidates.map((candidate, order) => ({...candidate, order, completed: false})), criteria, members: [admin], phase: "waiting", current: "", rounds: {}};
    await redisCommand("SET", keyFor(config), JSON.stringify(doc), "NX");
    await redisCommand("HSET", historyKey(), sessionId, JSON.stringify(config));
    await redisCommand("SET", activeElectionKey(), JSON.stringify(config));
    return config;
  } finally { await releaseLock(lock, owner); }
}
export async function endElection(sessionId: string, host: Person) {
  const config = await currentElection();
  if (!config?.open) throw new VotingError("No delib is open.", 409);
  if (config.sessionId !== sessionId) throw new VotingError("The delib changed. Reload before continuing.", 409);
  if (config.host !== host.email) throw new VotingError("Only the host can end this delib.", 403);
  await change(config, doc => {
    if (!["waiting", "locked"].includes(doc.phase)) throw new VotingError("Close the current candidate before ending the delib.", 409);
    doc.ended = true;
  });
  const ended: Settings = {...config, open: false, endedAt: Date.now()};
  await redisCommand("HSET", historyKey(), sessionId, JSON.stringify(ended));
  if (!await redisCommand("EVAL", "if redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('SET',KEYS[1],ARGV[2]); return 1 else return 0 end", 1, activeElectionKey(), JSON.stringify(config), JSON.stringify(ended))) throw new VotingError("The delib changed. Reload before continuing.", 409);
}

// An ended delib that `host` may change, with its saved record.
async function endedElection(sessionId: string, host: Person, verb: string) {
  const raw = await redisCommand<string | null>("HGET", historyKey(), sessionId);
  const config = raw ? JSON.parse(raw) as Settings : null;
  if (!raw || !config) throw new VotingError("This delib does not exist.", 404);
  if (config.host !== host.email) throw new VotingError(`Only the host can ${verb} this delib.`, 403);
  if (config.open) throw new VotingError(`End the delib before you ${verb} it.`, 409);
  return {raw, config};
}

// Renames an ended delib. Only its host can do this.
export async function renameElection(sessionId: string, name: string, host: Person) {
  const {raw, config} = await endedElection(sessionId, host, "rename");
  const renamed = JSON.stringify({...config, name: text(name, "delib name", 100)});
  // The last delib to end stays in the active key, so it is renamed there too.
  const script = "if redis.call('HGET',KEYS[1],ARGV[1]) ~= ARGV[2] then return 0 end; redis.call('HSET',KEYS[1],ARGV[1],ARGV[3]); if redis.call('GET',KEYS[2]) == ARGV[2] then redis.call('SET',KEYS[2],ARGV[3]) end; return 1";
  if (!await redisCommand("EVAL", script, 2, historyKey(), activeElectionKey(), sessionId, raw, renamed)) throw new VotingError("The delib changed. Reload before continuing.", 409);
}

// Removes an ended delib and all of its votes. Only its host can do this.
export async function deleteElection(sessionId: string, host: Person) {
  const {raw, config} = await endedElection(sessionId, host, "delete");
  // One atomic step, and only if the delib has not changed since it was read.
  // The last delib to end stays in the active key, so it is cleared there too.
  const script = "if redis.call('HGET',KEYS[1],ARGV[1]) ~= ARGV[2] then return 0 end; redis.call('HDEL',KEYS[1],ARGV[1]); redis.call('DEL',KEYS[2],KEYS[3]); if redis.call('GET',KEYS[4]) == ARGV[2] then redis.call('DEL',KEYS[4]) end; return 1";
  if (!await redisCommand("EVAL", script, 4, historyKey(), keyFor(config), `${keyFor(config)}:view`, activeElectionKey(), sessionId, raw)) throw new VotingError("The delib changed. Reload before continuing.", 409);
}

// Every delib, newest first.
export async function allElections() {
  const flat = await redisCommand<string[]>("HGETALL", historyKey());
  const all: Settings[] = [];
  for (let i = 1; i < flat.length; i += 2) all.push(JSON.parse(flat[i]) as Settings);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
export async function electionResults(sessionId: string, host: Person) {
  const raw = await redisCommand<string | null>("HGET", historyKey(), sessionId);
  const config = raw ? JSON.parse(raw) as Settings : null;
  if (!config || config.host !== host.email) throw new VotingError("Only the host can see these results.", 403);
  const {doc} = await load(config);
  authorize(identityFor(config, host), config, true);
  return {sessionId: config.sessionId, name: config.name, ended: !!doc.ended, voterCount: doc.members.filter(m=>m.role==='voter').length, criteria: doc.criteria,
    candidates: doc.candidates.map(candidate=>{
      const round = doc.rounds[candidate.id];
      const ballots = Object.entries(round?.votes || {}).filter(([id])=>!doc.members.find(m=>m.id===id)?.banned).map(([voterId,vote])=>({voterId,voterName:doc.members.find(m=>m.id===voterId)?.name || voterId,initial:vote.initial,final:vote.final,submittedAt:vote.at}));
      return {candidate,initialCount:Object.keys(round?.initial || {}).filter(id=>!doc.members.find(m=>m.id===id)?.banned).length,ballots,stats:doc.criteria.map(c=>summarizeRatings(ballots,c.id))};
    })};
}
