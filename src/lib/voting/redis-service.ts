import { summarizeRatings } from "./results";
import { polishElectionSheet, writeSummary } from "./sheet-layout";
import { randomUUID, createHash } from "node:crypto";
import { compareAndSet, redisCommand, redisKey, releaseLock } from "./redis";
import { Identity, text, VotingError } from "./security";
import { authorize, HEADERS, validateRatings, validateSetup } from "./service";
import type { Settings } from "./service";
import { readRanges, sheets, writeRanges } from "./sheets";
import type { Candidate, Criterion, Ratings, VotingPhase, VotingState } from "./types";

type Member = {banned?: boolean; rejoinRequested?: boolean; pending?: boolean; removed?: boolean; id: string; name: string; claimId: string; role: "admin" | "voter"; slot: number};
type Vote = {id: string; initial: Ratings; final: Ratings; at: string};
type Round = {version: string; initial: Record<string, string>; initialRatings?: Record<string, Ratings>; roster?: string[]; votes: Record<string, Vote>};
interface ExportRows {
  nextResponse: number;
  nextReceipt: number;
  responses: Record<string, Record<string, number>>;
  receipts: Record<string, Record<string, number>>;
}
interface Election {
  schema: 1;
  revision: number;
  marked?: boolean;
  ended?: boolean;
  initialized: boolean;
  candidates: Candidate[];
  criteria: Criterion[];
  members: Member[];
  roster?: string[];
  phase: VotingPhase;
  current: string;
  visible: boolean;
  rounds: Record<string, Round>;
  exportRows?: ExportRows;
  exportPending?: {id: string; candidateId: string; summaryOnly?: boolean};
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const keyFor = (config: Settings) => redisKey("session", config.settingsSheetId, config.sheetId, config.sessionId);
export async function redisSettings(): Promise<Settings> {
  const config = await currentElection();
  if (!config) throw new VotingError("No election is open yet.", 401);
  return config;
}

async function load(config: Settings): Promise<{raw: string; doc: Election}> {
  const key = keyFor(config);
  for (let i = 0; i < 50; i++) {
    const raw = await redisCommand<string | null>("GET", key);
    if (raw) {
      const doc = JSON.parse(raw) as Election;
      if (doc.schema !== 1) throw new VotingError("This deployment cannot read the saved election.", 503);
      if (!doc.marked) {
        const owner = randomUUID();
        if (await redisCommand("SET", `${key}:mark`, owner, "NX", "EX", 90)) {
          try {
            await markRedis(config);
            doc.marked = true;
            await compareAndSet(key, raw, JSON.stringify(doc));
          } finally { await releaseLock(`${key}:mark`, owner); }
        } else await delay(200);
        continue;
      }
      return {raw, doc};
    }
    throw new VotingError("Election data is missing. Restore Redis before continuing.", 503);
  }
  throw new VotingError("The election is loading. Please retry.", 503, 2);
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
    if (Buffer.byteLength(next) > 8_000_000) throw new VotingError("This election has reached its storage limit. Existing votes are safe.", 409);
    if (await compareAndSet(keyFor(config), raw, next, publicDocument(doc))) return result;
    await delay(20 + Math.random() * Math.min(600, (attempt + 1) * 40));
  }
  throw new VotingError("Voting is busy. Please retry.", 503, 2);
}
function member(doc: Election, identity: Identity, admin = false) {
  const found = doc.members.find(m => m.id === identity.id && m.claimId === identity.claimId);
  if (found?.banned) throw new VotingError("You are banned from this session.", 401);
  if (found?.removed) throw new VotingError("You were kicked from this session. You can join again.", 401);
  if (!found || (admin && found.role !== "admin")) throw new VotingError(admin ? "Admin access required." : "Join the session again.", admin ? 403 : 401);
  return found;
}
function identityFor(config: Settings, m: Member): Identity {
  return {id: m.id, name: m.name, role: m.role, claimId: m.claimId, voterSlot: m.slot, sessionId: config.sessionId, sheetId: config.sheetId, exp: Date.now() + 24 * 3600_000};
}
export async function redisClaim(config: Settings, name: string, existing: Identity | null, joinId?: string) {
  const stable = joinId ? createHash("sha256").update(JSON.stringify([config.sessionId, config.sheetId, joinId])).digest("hex") : undefined;
  const id = stable || randomUUID(), claimId = stable || randomUUID();
  const result = await change<Identity>(config, doc => {
    if (existing?.sessionId === config.sessionId && existing.sheetId === config.sheetId) {
      const known = doc.members.find(m => m.id === existing.id && m.claimId === existing.claimId);
      if (known?.banned) throw new VotingError("You are banned from this session.", 403);
      if (known?.removed) { known.removed = false; known.pending = Object.keys(doc.rounds).length > 0; known.rejoinRequested = false; }
      if (known) { known.name = name; return identityFor(config, known); }
    }
    const retry = doc.members.find(m => m.id === id && m.claimId === claimId);
    if (retry?.banned) throw new VotingError("You are banned from this session.", 403);
    if (retry?.removed) { retry.removed = false; retry.pending = Object.keys(doc.rounds).length > 0; retry.rejoinRequested = false; }
    if (retry) { retry.name = name; return identityFor(config, retry); }
    if (doc.members.length >= 129) throw new VotingError("This session has reached its 128-voter limit.", 409);
    const m: Member = {pending: Object.keys(doc.rounds).length > 0, id, claimId, name, role: "voter", slot: doc.members.length - 1};
    doc.members.push(m);
    return identityFor(config, m);
  });
  return result;
}
export async function redisCanonical(config: Settings, identity: Identity) {
  if (identity.role !== "admin") return identity;
  return identityFor(config, member(await readView(config), identity, true));
}
export async function redisVoters(config: Settings) {
  return (await readView(config)).members.filter(m => m.role === "voter").map(m => ({id: m.id, name: m.name}));
}
function present(config: Settings, identity: Identity, doc: Election): VotingState {
  const m = member(doc, identity);
  const admin = m.role === "admin";
  const liveRound = doc.rounds[doc.current];
  const eligible = !m.pending && (!liveRound || !(liveRound.roster || doc.roster) || (liveRound.roster || doc.roster)!.includes(m.id));
  if (!admin && !eligible) return {pollIntervalMs: 3000, sessionId: config.sessionId, active: !doc.ended, phase: "waiting", votingStarted: true, ballotVersion: "", currentCandidate: null, criteria: [], contextVisible: false, submittedCount: 0, voter: {id: m.id, name: m.name}, isAdmin: false, initialized: true, eligible: false, admissionPending: !!m.pending};
  const current = doc.candidates.find(c => c.id === doc.current) || null;
  const round = doc.rounds[doc.current];
  const counted = (r?: Round) => Object.keys(r?.votes || {}).filter(id=>!doc.members.find(m=>m.id===id)?.banned).length;
  const participants = (r?: Round) => doc.members.filter(m => m.role === "voter" && !m.removed && !m.pending && (!(r?.roster || doc.roster) || (r?.roster || doc.roster)!.includes(m.id))).map(m => ({id: m.id, name: m.name, submitted: !!r?.votes[m.id], initialSubmitted: !!r?.initial[m.id]}));
  const complete = doc.phase === "locked" && !doc.exportPending && doc.candidates.length > 0 && doc.candidates.every(c=>c.completed);
  return {pollIntervalMs: !admin && complete ? 10000 : 3000, sessionId: config.sessionId, active: !!config.password && !doc.ended, votingComplete: doc.phase === "locked" && !doc.exportPending && doc.candidates.length > 0 && doc.candidates.every(c=>c.completed), phase: doc.phase, votingStarted: Object.keys(doc.rounds).length > 0, ballotVersion: round?.version || "", currentCandidate: current && {...current, context: current.context}, criteria: doc.criteria, contextVisible: !!current?.context, submittedCount: counted(round), voter: {id: m.id, name: m.name}, isAdmin: admin, initialized: doc.initialized, ownBallot: {initialSubmitted: !!round?.initial[m.id], submitted: !!round?.votes[m.id]}, eligible: admin || !round || !(round.roster || doc.roster) || (round.roster || doc.roster)!.includes(m.id),
    ...(admin ? {voters: doc.members.filter(v => v.role === "voter").map(v => ({id: v.id, name: v.name, removed: !!v.removed, banned: !!v.banned, eligible: !v.pending && (!round || !!(round.roster || doc.roster)?.includes(v.id))})), candidates: doc.candidates, participants: participants(round), exportPending: !!doc.exportPending, candidateStates: doc.candidates.map(c => ({candidateId: c.id, phase: c.id === doc.current ? doc.phase : c.completed ? "locked" : "waiting", ballotVersion: doc.rounds[c.id]?.version || "", submittedCount: counted(doc.rounds[c.id]), participants: participants(doc.rounds[c.id])}))} : {})};
}
export async function redisState(config: Settings, identity: Identity) { return present(config, identity, await readView(config)); }

// Polling validates the current election on every request, without caching admission.
export async function voterPoll(identity: Identity) {
  if (identity.role !== "voter") throw new VotingError("Enter the president password.", 401);
  const expected: Settings = {sessionId:identity.sessionId,sheetId:identity.sheetId,settingsSheetId:"president-v1",password:""};
  const [active, snapshot] = await redisCommand<(string | null)[]>("MGET", activeElectionKey(), `${keyFor(expected)}:view`);
  if (!active) throw new VotingError("No election is open yet.", 401);
  const config = JSON.parse(active) as Settings;
  authorize(identity, config);
  const doc = snapshot && config.settingsSheetId === expected.settingsSheetId ? JSON.parse(snapshot) as Election : await readView(config);
  return {config, identity, state:present(config,identity,doc)};
}
export async function presidentPoll() {
  const config = await redisSettings();
  const doc = await readView(config);
  const admin = doc.members.find(m=>m.role === "admin");
  if (!admin) throw new VotingError("Election admin is missing.", 503);
  const identity = identityFor(config,admin);
  return {config,identity,state:present(config,identity,doc)};
}


export async function redisSubmit(config: Settings, identity: Identity, input: Record<string, unknown>, initial: boolean) {
  const at = new Date().toISOString();
  return change(config, doc => {
    const m = member(doc, identity);
    if (m.pending) throw new VotingError("Wait for the admin to admit you.", 403);
    if (m.role === "admin") throw new VotingError("Admins do not vote.", 403);
    if (input.sessionId !== config.sessionId) throw new VotingError("This ballot belongs to another session.", 409);
    const candidateId = text(input.candidateId, "candidate ID", 100);
    const r = Object.hasOwn(doc.rounds, candidateId) ? doc.rounds[candidateId] : undefined;
    if (!r || r.version !== input.ballotVersion) throw new VotingError("This ballot is no longer current.", 409);
    // A lost acknowledgement remains recoverable after closing or switching candidates.
    if (initial && r.initial[m.id]) return {ok: true};
    if (!initial && r.votes[m.id]) return {ok: true, submissionId: r.votes[m.id].id};
    if (doc.ended || !config.password || doc.exportPending || candidateId !== doc.current || !(initial ? ["initial"] : ["revision", "final"]).includes(doc.phase)) throw new VotingError(initial ? "Initial ratings have closed for this candidate." : "Final submissions are not currently open.", 409);
    if (!(r.roster || doc.roster)?.includes(m.id)) throw new VotingError("You are not admitted for this candidate. Ask the admin during initial ratings, or wait for the next candidate.", 409);
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
  const exportId = randomUUID(), version = randomUUID();
  await change(config, doc => {
    member(doc, identity, true);
    if (doc.ended) throw new VotingError("This election has ended.", 409);
    if (doc.exportPending) {
      if (input.action === "setPhase" && input.phase === "locked") return;
      throw new VotingError("Export this candidate to Sheets before continuing.", 409);
    }
    if (input.action === "initialize") { doc.initialized = true; return; }
    if (!doc.initialized) throw new VotingError("Set up this election first.", 409);
    if (input.action === "saveSetup") {
      if (Object.keys(doc.rounds).length) throw new VotingError("Setup can only change before voting starts.", 409);
      validateSetup(input.candidates as Candidate[], input.criteria as Criterion[]);
      doc.candidates = (input.candidates as Candidate[]).map((c, order) => ({...c, order, completed: false}));
      doc.criteria = input.criteria as Criterion[];
      if (!doc.candidates.some(c => c.id === doc.current)) doc.current = "";
      return;
    }
    if (input.action === "removeVoters" || input.action === "banVoters" || input.action === "admitVoters") {
      if (!Array.isArray(input.voterIds) || !input.voterIds.length || input.voterIds.length > 128 || input.voterIds.some(id => typeof id !== "string")) throw new VotingError("Select voters first.");
      const selected = input.voterIds.map(id => doc.members.find(v => v.id === id && v.role === "voter"));
      if (selected.some(v => !v)) throw new VotingError("One of the selected voters was not found.", 404);
      if (input.action === "removeVoters" || input.action === "banVoters") {
        for (const voter of selected) { voter!.removed = true; voter!.rejoinRequested = false; if (input.action === "banVoters") voter!.banned = true; }
        if (input.action === "banVoters" && doc.candidates.some(c=>c.completed)) doc.exportPending = {id:exportId,candidateId:doc.current,summaryOnly:true};
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
    if (input.action === "removeVoter" || input.action === "admitVoter") {
      const voter = doc.members.find(v => v.id === input.voterId && v.role === "voter");
      if (!voter) throw new VotingError("Voter not found.", 404);
      if (input.action === "removeVoter") { voter.removed = true; return; }
      if (voter.banned) throw new VotingError("Banned voters cannot be admitted to this session.", 409);
      const round = doc.rounds[doc.current];
      if (round && doc.phase !== "initial") throw new VotingError("Admit voters during initial ratings or before the next candidate starts.", 409);
      voter.removed = false; voter.pending = false; voter.rejoinRequested = false;
      if (round) {
        round.roster ||= [...(doc.roster || [])];
        if (!round.roster.includes(voter.id)) round.roster.push(voter.id);
      }
      return;
    }
    if (input.action === "setContext") {
      if (typeof input.visible !== "boolean") throw new VotingError("Invalid context visibility.");
      doc.visible = input.visible; return;
    }
    if (input.action !== "setPhase") throw new VotingError("Unknown admin action.");
    if (input.expected) {
      const expected = input.expected as {candidateId?: string; version?: string; phase?: string};
      if (expected.candidateId !== doc.current || expected.version !== (doc.rounds[doc.current]?.version || "") || expected.phase !== doc.phase) throw new VotingError("The session changed. Refresh before continuing.", 409);
    }
    const next = input.phase as VotingPhase;
    const idle = ["waiting", "locked"].includes(doc.phase);
    const selected = doc.candidates.find(c => c.id === (input.candidateId || doc.current));
    if (next === "waiting" && idle && input.candidateId) {
      if (!selected || selected.completed) throw new VotingError("Choose an unfinished candidate.", 409);
      doc.current = selected.id; doc.phase = "waiting"; doc.visible = false; return;
    }
    if (next === "initial" && idle) {
      if (!config.password) throw new VotingError("The session is closed.", 409);
      if (!selected || selected.completed || doc.rounds[selected.id]) throw new VotingError("Choose an unfinished candidate.", 409);
      validateSetup(doc.candidates, doc.criteria);
      if (!doc.criteria.length) throw new VotingError("Add at least one criterion.");
      doc.roster ||= doc.members.filter(m => m.role === "voter" && !m.removed && !m.pending).map(m => m.id);
      doc.rounds[selected.id] = {version, initial: {}, initialRatings: {}, roster: doc.members.filter(m => m.role === "voter" && !m.removed && !m.pending).map(m => m.id), votes: {}};
      doc.current = selected.id; doc.phase = "initial"; doc.visible = false; return;
    }
    if (next === "final" && idle && input.candidateId) {
      if (!selected || !doc.rounds[selected.id]) throw new VotingError("That candidate has no ballot to reopen.", 409);
      doc.current = selected.id; doc.phase = "final"; doc.visible = true; return;
    }
    const allowed: Record<VotingPhase, VotingPhase[]> = {waiting: [], initial: ["deliberation", "revision", "final", "locked"], deliberation: ["revision", "final", "locked"], revision: ["deliberation", "final", "locked"], final: ["locked"], locked: []};
    if (next === doc.phase) return;
    if (!allowed[doc.phase].includes(next)) throw new VotingError("That phase change is not available.", 409);
    doc.phase = next;
    if (next === "locked") {
      allocateExportRows(doc, doc.current);
      doc.exportPending = {id: exportId, candidateId: doc.current};
      // Mark complete only after Sheets acknowledges the export.
    }
  });
  const {doc} = await load(config);
  if (doc.exportPending) {
    const pending = doc.exportPending;
    try {
      if (pending.summaryOnly) {
        const meta = await sheets<{sheets:{properties:{sheetId:number;title:string}}[]}>(config.sheetId, "?fields=sheets.properties", "GET", undefined, true);
        const summary = meta.sheets.find(s=>s.properties.title === "Summary");
        if (!summary) throw new VotingError("Summary sheet is missing.",409);
        await writeSummary(config.sheetId,doc.candidates,doc.criteria,summary.properties.sheetId,doc.members.filter(m=>m.banned).map(m=>m.id));
      } else await exportCandidate(config, doc, pending.candidateId);
    }
    catch { throw new VotingError("Votes are saved in Redis. Export to Sheets failed. Retry the export before continuing.", 503, 2); }
    await change(config, latest => {
      if (latest.exportPending?.id !== pending.id) return;
      if (!pending.summaryOnly) latest.candidates.find(c => c.id === pending.candidateId)!.completed = true;
      delete latest.exportPending;
    });
  }
  return redisState(config, identity);
}

const receiptHeaders = ["session_id", "candidate_id", "ballot_version", "voter_id", "submitted_at", "initial_ratings_json", "voter_name"];
async function exportCandidate(config: Settings, doc: Election, candidateId: string) {
  const candidateIndex = doc.candidates.findIndex(c => c.id === candidateId);
  const candidate = doc.candidates[candidateIndex];
  const round = doc.rounds[candidateId];
  type Meta = {sheets: {properties: {sheetId: number; title: string; gridProperties?: {rowCount: number}}}[]};
  // Structure reads happen only on exports, never during polling or individual submissions.
  let meta = await sheets<Meta>(config.sheetId, "?fields=sheets.properties(sheetId,title,gridProperties.rowCount)", "GET", undefined, true);
  const headers = {...HEADERS, "Initial submissions": receiptHeaders};
  const existing = Object.keys(headers).filter(title => meta.sheets.some(s => s.properties.title === title));
  if (existing.length) {
    const rows = await readRanges(config.sheetId, existing.map(title => `'${title}'!A1:L1`), true);
    rows.forEach((r, i) => {
      if (r.length && ((existing[i] === "Initial submissions" ? receiptHeaders.slice(0, 5) : headers[existing[i] as keyof typeof headers]).some((h, col) => r[0]?.[col] !== h) && !(existing[i] === "Summary" && ["Session", "Candidate"].includes(r[0]?.[0])))) throw new VotingError("Restore the election spreadsheet headers before exporting.", 409);
    });
  }
  const missing = Object.keys(headers).filter(title => !existing.includes(title));
  if (missing.length) {
    try { await sheets(config.sheetId, ":batchUpdate", "POST", {requests: missing.map(title => ({addSheet: {properties: {title}}}))}); }
    catch {
      // Concurrent retries may have created the same tabs. Read structure again before deciding.
      meta = await sheets<Meta>(config.sheetId, "?fields=sheets.properties(sheetId,title,gridProperties.rowCount)", "GET", undefined, true);
      if (missing.some(title => !meta.sheets.some(s => s.properties.title === title))) throw new VotingError("Could not create export tabs.", 503);
    }
    meta = await sheets<Meta>(config.sheetId, "?fields=sheets.properties(sheetId,title,gridProperties.rowCount)", "GET", undefined, true);
  }
  const requests = meta.sheets.flatMap(({properties: p}) => {
    const needed = p.title === "Responses" ? (doc.exportRows ? doc.exportRows.nextResponse - 1 : 1 + doc.candidates.length * 128 * doc.criteria.length) : p.title === "Initial submissions" ? (doc.exportRows ? doc.exportRows.nextReceipt - 1 : 1 + doc.candidates.length * 128) : 0;
    return needed > (p.gridProperties?.rowCount || 1000) ? [{updateSheetProperties: {properties: {sheetId: p.sheetId, gridProperties: {rowCount: needed}}, fields: "gridProperties.rowCount"}}] : [];
  });
  if (requests.length) await sheets(config.sheetId, ":batchUpdate", "POST", {requests});
  const data: Parameters<typeof writeRanges>[1] = Object.entries(headers).filter(([title]) => title !== "Summary").map(([title, values]) => ({range: `'${title}'!A1`, values: [values]}));
  // All exports use deterministic cells. Previously accepted votes are immutable; retries only
  // rewrite identical values and never clear empty slots. Even a delayed older export is harmless.
  for (const m of doc.members.filter(m => m.role === "voter")) {
    const slot = candidateIndex * 128 + m.slot;
    if (round.initial[m.id]) data.push({range: `'Initial submissions'!A${doc.exportRows?.receipts[candidateId]?.[m.id] ?? (2 + slot)}`, values: [[config.sessionId, candidateId, round.version, m.id, round.initial[m.id], round.initialRatings?.[m.id] ? JSON.stringify(round.initialRatings[m.id]) : "", m.name]]});
    const vote = round.votes[m.id];
    if (vote) data.push({range: `'Responses'!A${doc.exportRows?.responses[candidateId]?.[m.id] ?? (2 + slot * doc.criteria.length)}`, values: doc.criteria.map(c => [vote.id, config.sessionId, candidateId, candidate.name, m.id, m.name, round.version, c.id, c.label, vote.initial[c.id] ?? "", vote.final[c.id] ?? "", vote.at])});
  }
  // Definitions are frozen for every export. Only this candidate's completion cell changes.
  data.push({range: "'Candidates'!A2:D101", values: [...doc.candidates.map(c => [c.id, c.name, c.context, c.order]), ...Array.from({length: 100 - doc.candidates.length}, () => ["", "", "", ""])]});
  data.push({range: `'Candidates'!E${candidateIndex + 2}`, values: [[true]]});
  data.push({range: "'Criteria'!A2:F21", values: [...doc.criteria.map(c => [c.id, c.label, c.description, c.min, c.max, c.required]), ...Array.from({length: 20 - doc.criteria.length}, () => ["", "", "", "", "", ""])]});
  data.push({range: `'Ballots'!A${candidateIndex + 2}`, values: [[candidateId, round.version, candidate.name, candidate.context, JSON.stringify(doc.criteria)]]});
  
  await writeRanges(config.sheetId, data);
  await writeSummary(config.sheetId, doc.candidates, doc.criteria, meta.sheets.find(s => s.properties.title === "Summary")!.properties.sheetId, doc.members.filter(m=>m.banned).map(m=>m.id));
  await polishElectionSheet(config.sheetId, meta.sheets, doc.criteria.length);

}

async function markRedis(config: Settings) {
  const metadata = await sheets<{sheets: {properties: {title: string}}[]}>(config.sheetId, "?fields=sheets.properties.title", "GET", undefined, true);
  if (!metadata.sheets.some(s => s.properties.title === "Session")) await sheets(config.sheetId, ":batchUpdate", "POST", {requests: [{addSheet: {properties: {title: "Session"}}}]});
  const [rows] = await readRanges(config.sheetId, ["'Session'!A1:B20"], true);
  if (rows.length && (rows[0]?.[0] !== "key" || rows[0]?.[1] !== "value")) throw new VotingError("Restore the Session tab headers.", 409);
  const runtime = Object.fromEntries(rows.slice(1).filter(r => r[0]).map(r => [r[0], r[1] || ""])) as Record<string, string>;
  await writeRanges(config.sheetId, [{range: "'Session'!A1", values: [["key", "value"], ...Object.entries({...runtime, session_id: config.sessionId, ...(config.name ? {name: config.name} : {}), storage_backend: "redis"})]}]);
}

function publicDocument(doc: Election) {
  // Polling reads this small projection. Ratings stay only in the private Redis document.
  return JSON.stringify({...doc, exportRows: undefined, rounds: Object.fromEntries(Object.entries(doc.rounds).map(([id, r]) => [id, {...r, initialRatings: undefined, initial: Object.fromEntries(Object.keys(r.initial).map(id => [id, true])), votes: Object.fromEntries(Object.keys(r.votes).map(id => [id, true]))}]))});
}
async function readView(config: Settings): Promise<Election> {
  const raw = await redisCommand<string | null>("GET", `${keyFor(config)}:view`);
  if (raw) return JSON.parse(raw) as Election;
  return (await load(config)).doc;
}

function allocateExportRows(doc: Election, candidateId: string) {
  // Old elections retain their original cell addresses. New elections allocate only real votes.
  // Reserve addresses in the same transaction that closes admission, before contacting Sheets.
  const rows = doc.exportRows;
  if (!rows) return;
  const responseRows = rows.responses[candidateId] ||= {};
  const receiptRows = rows.receipts[candidateId] ||= {};
  const round = doc.rounds[candidateId];
  for (const m of doc.members) {
    if (round.votes[m.id] && !responseRows[m.id]) {
      responseRows[m.id] = rows.nextResponse;
      rows.nextResponse += doc.criteria.length;
    }
    if (round.initial[m.id] && !receiptRows[m.id]) receiptRows[m.id] = rows.nextReceipt++;
  }
}

export async function redisRecoverBallot(config: Settings, identity: Identity, candidateId: string, version: string) {
  const {doc} = await load(config);
  const m = member(doc, identity);
  if (m.pending) throw new VotingError("Wait for the admin to admit you.", 403);
  if (m.role !== "voter") throw new VotingError("Admins do not vote.", 403);
  const round = Object.hasOwn(doc.rounds, candidateId) ? doc.rounds[candidateId] : undefined;
  if (!round || round.version !== version) throw new VotingError("This ballot is no longer available.", 409);
  const vote = round.votes[m.id];
  return {initialRatings: round.initialRatings?.[m.id] || vote?.initial || null, finalRatings: vote?.final || null, submissionId: vote?.id || null};
}

const activeElectionKey = () => redisKey("president-active-election");
export async function currentElection(): Promise<Settings | null> {
  const raw = await redisCommand<string | null>("GET", activeElectionKey());
  return raw ? JSON.parse(raw) as Settings : null;
}
export async function presidentIdentity(config: Settings) {
  const doc = await readView(config);
  const admin = doc.members.find(m => m.role === "admin");
  if (!admin) throw new VotingError("Election admin is missing.", 503);
  return identityFor(config, admin);
}
export async function createElection(input: Record<string, unknown>) {
  const sessionId = text(input.requestId, "request ID", 36);
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) throw new VotingError("Invalid request ID.");
  const name = input.name ? text(input.name, "election name", 100) : `Election ${new Date().toISOString().slice(0, 10)}`;
  const setup = input.candidates !== undefined || input.criteria !== undefined;
  const candidates = (input.candidates || []) as Candidate[];
  const criteria = (input.criteria || []) as Criterion[];
  validateSetup(candidates, criteria);
  if (setup && (!candidates.length || !criteria.length)) throw new VotingError("Add candidates and criteria before opening the session.");
  const password = text(input.password, "voter password", 500);
  const link = text(input.sheetUrl, "spreadsheet link", 1000);
  const sheetId = link.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  if (!sheetId) throw new VotingError("Paste a Google Sheets link.");
  const config: Settings = {sessionId, name, password, sheetId, settingsSheetId: "president-v1", presidentManaged: true};
  const owner = randomUUID(), lock = `${activeElectionKey()}:lock`;
  if (!await redisCommand("SET", lock, owner, "NX", "EX", 120)) throw new VotingError("Election setup is busy. Retry shortly.", 503, 2);
  try {
    const raw = await redisCommand<string | null>("GET", activeElectionKey());
    const active = raw ? JSON.parse(raw) as Settings : null;
    if (active?.sessionId === sessionId) return active;
    if (active?.password) throw new VotingError("End the current election before creating another.", 409);
    const key = keyFor(config);
    const reservation = redisKey("election-creation", sessionId);
    const reserved = await redisCommand<string | null>("GET", reservation);
    // Preserve the generated date label if a creation retry crosses midnight.
    if (reserved && !input.name) config.name = JSON.parse(reserved).name;
    const encoded = JSON.stringify(config);
    const setupKey = `${reservation}:ballot`;
    const ballot = JSON.stringify({candidates, criteria});
    const reservedBallot = await redisCommand<string | null>("GET", setupKey);
    if (reservedBallot && reservedBallot !== ballot) throw new VotingError("Retry with the original ballot setup, or reload to start again.", 409);
    if (reserved && reserved !== encoded) throw new VotingError("Retry with the original setup values, or reload to start a new setup.", 409);
    if (!reserved) await redisCommand("SET", reservation, encoded);
    if (!reservedBallot) await redisCommand("SET", setupKey, ballot);
    if (!await redisCommand("GET", key)) {
      const meta = await sheets<{sheets: {properties: {title: string}}[]}>(sheetId, "?fields=sheets.properties.title", "GET", undefined, true);
      if (meta.sheets.some(s => Object.hasOwn(HEADERS, s.properties.title))) throw new VotingError("Use a new spreadsheet for this election.", 409);
      const admin: Member = {id: randomUUID(), claimId: randomUUID(), name: "President", role: "admin", slot: -1};
      const doc: Election = {schema: 1, revision: 0, initialized: true, candidates: candidates.map((candidate, order) => ({...candidate, order, completed: false})), criteria, members: [admin], phase: "waiting", current: "", visible: false, rounds: {}, exportRows: {nextResponse: 2, nextReceipt: 2, responses: {}, receipts: {}}};
      await redisCommand("SET", key, JSON.stringify(doc), "NX");
    }
    await load(config); // Writes the Session marker, verifying Sheets edit access before admission.
    const ok = await redisCommand("EVAL", "if redis.call('GET',KEYS[1]) == ARGV[1] or (not redis.call('GET',KEYS[1]) and ARGV[1] == '') then redis.call('SET',KEYS[1],ARGV[2]); return 1 else return 0 end", 1, activeElectionKey(), raw || "", encoded);
    if (!ok) throw new VotingError("The active election changed. Reload before continuing.", 409);
    return config;
  } finally { await releaseLock(lock, owner); }
}
export async function endElection(sessionId: string) {
  const raw = await redisCommand<string | null>("GET", activeElectionKey());
  if (!raw) throw new VotingError("No election is open.", 409);
  const config = JSON.parse(raw) as Settings;
  if (config.sessionId !== sessionId) throw new VotingError("The election changed. Reload before continuing.", 409);
  await change(config, doc => {
    if (doc.exportPending || !["waiting", "locked"].includes(doc.phase)) throw new VotingError("Close the current candidate and finish exporting before ending the election.", 409);
    doc.ended = true;
  });
  if (!await redisCommand("EVAL", "if redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('SET',KEYS[1],ARGV[2]); return 1 else return 0 end", 1, activeElectionKey(), raw, JSON.stringify({...config, password: ""}))) throw new VotingError("The election changed. Reload before continuing.", 409);
}

// President-only route calls this directly, including after the session is closed.
// Read the authoritative ballots, never the redacted polling projection.
export async function electionResults(config: Settings) {
  const raw = await redisCommand<string | null>('GET', keyFor(config));
  if (!raw) throw new VotingError('Election results are unavailable.', 404);
  const doc = JSON.parse(raw) as Election;
  return {sessionId: config.sessionId, ended: !!doc.ended, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${config.sheetId}/edit`, voterCount: doc.members.filter(m=>m.role==='voter').length, criteria: doc.criteria,
    candidates: doc.candidates.map(candidate=>{
      const round = doc.rounds[candidate.id];
      const ballots = Object.entries(round?.votes || {}).filter(([id])=>!doc.members.find(m=>m.id===id)?.banned).map(([voterId,vote])=>({voterId,voterName:doc.members.find(m=>m.id===voterId)?.name || voterId,initial:vote.initial,final:vote.final,submittedAt:vote.at}));
      return {candidate,initialCount:Object.keys(round?.initial || {}).filter(id=>!doc.members.find(m=>m.id===id)?.banned).length,ballots,stats:doc.criteria.map(c=>summarizeRatings(ballots,c.id))};
    })};
}
