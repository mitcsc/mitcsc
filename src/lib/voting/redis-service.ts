import { polishElectionSheet, writeSummary } from "./sheet-layout";
import { randomUUID, createHash } from "node:crypto";
import { compareAndSet, redisCommand, redisKey, releaseLock } from "./redis";
import { Identity, text, VotingError } from "./security";
import { HEADERS, sheetSettings, snapshot, validateRatings, validateSetup } from "./service";
import type { Settings } from "./service";
import { readControlSheet, readRanges, sheets, writeRanges } from "./sheets";
import type { Candidate, Criterion, Ratings, VotingPhase, VotingState } from "./types";

type Member = {id: string; name: string; claimId: string; role: "admin" | "voter"; slot: number};
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
  exportPending?: {id: string; candidateId: string};
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const keyFor = (config: Settings) => redisKey("session", config.settingsSheetId, config.sheetId, config.sessionId);
let localSettings: {value: Settings; until: number} | undefined;

export async function redisSettings(): Promise<Settings> {
  if (localSettings && Date.now() < localSettings.until) return localSettings.value;
  const key = redisKey("settings", process.env.VOTING_SETTINGS_SHEET_ID || "1CRZtuOwF7iouzHrj_n5TCofcNtCtzfBQvsa8Ez9wLXQ");
  for (let i = 0; i < 40; i++) {
    const cached = await redisCommand<string | null>("GET", key);
    if (cached) {
      const value = JSON.parse(cached) as Settings;
      localSettings = {value, until: Date.now() + 5000};
      return value;
    }
    const owner = randomUUID();
    if (await redisCommand("SET", `${key}:lock`, owner, "NX", "EX", 30)) {
      try {
        const existing = await redisCommand<string | null>("GET", key);
        if (existing) { const value = JSON.parse(existing) as Settings; localSettings = {value, until: Date.now() + 5000}; return value; }
        const value = await sheetSettings(true);
        await redisCommand("SET", key, JSON.stringify(value), "EX", 30);
        localSettings = {value, until: Date.now() + 5000};
        return value;
      } finally { await releaseLock(`${key}:lock`, owner); }
    }
    await delay(150 + Math.random() * 100);
  }
  throw new VotingError("Session settings are loading. Please retry.", 503, 2);
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
    const owner = randomUUID();
    if (await redisCommand("SET", `${key}:import`, owner, "NX", "EX", 90)) {
      try {
        if (await redisCommand("GET", key)) continue;
        // Import only an unstarted election. Never silently replace an election or recover missing Redis votes from an older export.
        const metadata = await sheets<{sheets: {properties: {title: string}}[]}>(config.sheetId, "?fields=sheets.properties.title", "GET", undefined, true);
        if (metadata.sheets.some(s => s.properties.title === "Session")) {
          const [rows] = await readRanges(config.sheetId, ["'Session'!A:B"], true);
          if (rows.some(row => row[0] === "storage_backend" && row[1] === "redis")) throw new VotingError("The Redis election is missing. Restore the database before continuing.", 503);
        }
        const s = await snapshot(config, true);
        if (s.runtime.storage_backend === "redis") throw new VotingError("The Redis election is missing. Restore the database before continuing.", 503);
        if (s.runtime.session_id && s.runtime.session_id !== config.sessionId) throw new VotingError("Use a new election spreadsheet for this session.", 409);
        if (s.ballots.length || s.responses.length || s.receipts.length || s.runtime.ballot_version || s.candidates.some(c => c.completed)) throw new VotingError("Start a new session and election spreadsheet to switch to Redis. Existing votes remain in Sheets.", 409);
        const {history} = await readControlSheet(config.settingsSheetId, true);
        const rows = (history || []).slice(1).filter(row => row[0] === config.sessionId && row[1] === config.sheetId);
        const members: Member[] = [];
        for (const row of rows) if (row[3] && !members.some(m => m.id === row[3])) members.push({id: row[3], name: row[4], claimId: row[2], role: members.length ? "voter" : "admin", slot: members.length - 1});
        const doc: Election = {schema: 1, revision: 0, initialized: s.initialized, candidates: s.candidates, criteria: s.criteria, members, phase: "waiting", current: "", visible: false, rounds: {}, exportRows: {nextResponse: 2, nextReceipt: 2, responses: {}, receipts: {}}};
        const encoded = JSON.stringify(doc);
        await redisCommand("SET", key, encoded, "NX");
      } finally { await releaseLock(`${key}:import`, owner); }
    } else await delay(150 + Math.random() * 100);
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
  if (!found || (admin && found.role !== "admin")) throw new VotingError(admin ? "Admin access required." : "Join the session again.", admin ? 403 : 401);
  return found;
}
function identityFor(config: Settings, m: Member): Identity {
  return {id: m.id, name: m.name, role: m.role, claimId: m.claimId, voterSlot: m.slot, sessionId: config.sessionId, sheetId: config.sheetId, exp: Date.now() + 24 * 3600_000};
}
export async function redisClaim(config: Settings, name: string, existing: Identity | null, joinId?: string) {
  const stable = joinId ? createHash("sha256").update(JSON.stringify([config.sessionId, config.sheetId, joinId])).digest("hex") : undefined;
  const id = stable || randomUUID(), claimId = stable || randomUUID();
  return change(config, doc => {
    if (existing?.sessionId === config.sessionId && existing.sheetId === config.sheetId) {
      const known = doc.members.find(m => m.id === existing.id && m.claimId === existing.claimId);
      if (known) return identityFor(config, known);
    }
    const retry = doc.members.find(m => m.id === id && m.claimId === claimId);
    if (retry) return identityFor(config, retry);
    if (doc.members.length >= 129) throw new VotingError("This session has reached its 128-voter limit.", 409);
    const m: Member = {id, claimId, name, role: doc.members.length ? "voter" : "admin", slot: doc.members.length - 1};
    doc.members.push(m);
    return identityFor(config, m);
  });
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
  const current = doc.candidates.find(c => c.id === doc.current) || null;
  const round = doc.rounds[doc.current];
  const participants = (r?: Round) => doc.members.filter(m => m.role === "voter" && (!(r?.roster || doc.roster) || (r?.roster || doc.roster)!.includes(m.id))).map(m => ({id: m.id, name: m.name, submitted: !!r?.votes[m.id], initialSubmitted: !!r?.initial[m.id]}));
  return {pollIntervalMs: 3000, sessionId: config.sessionId, active: !!config.password, phase: doc.phase, votingStarted: Object.keys(doc.rounds).length > 0, ballotVersion: round?.version || "", currentCandidate: current && {...current, context: admin || doc.visible ? current.context : ""}, criteria: doc.criteria, contextVisible: doc.visible, submittedCount: Object.keys(round?.votes || {}).length, voter: {id: m.id, name: m.name}, isAdmin: admin, initialized: doc.initialized, ownBallot: {initialSubmitted: !!round?.initial[m.id], submitted: !!round?.votes[m.id]}, eligible: admin || !round || !(round.roster || doc.roster) || (round.roster || doc.roster)!.includes(m.id),
    ...(admin ? {candidates: doc.candidates, participants: participants(round), exportPending: !!doc.exportPending, candidateStates: doc.candidates.map(c => ({candidateId: c.id, phase: c.id === doc.current ? doc.phase : c.completed ? "locked" : "waiting", ballotVersion: doc.rounds[c.id]?.version || "", submittedCount: Object.keys(doc.rounds[c.id]?.votes || {}).length, participants: participants(doc.rounds[c.id])}))} : {})};
}
export async function redisState(config: Settings, identity: Identity) { return present(config, identity, await readView(config)); }

export async function redisSubmit(config: Settings, identity: Identity, input: Record<string, unknown>, initial: boolean) {
  const at = new Date().toISOString();
  return change(config, doc => {
    const m = member(doc, identity);
    if (m.role === "admin") throw new VotingError("Admins do not vote.", 403);
    if (input.sessionId !== config.sessionId) throw new VotingError("This ballot belongs to another session.", 409);
    const candidateId = text(input.candidateId, "candidate ID", 100);
    const r = Object.hasOwn(doc.rounds, candidateId) ? doc.rounds[candidateId] : undefined;
    if (!r || r.version !== input.ballotVersion) throw new VotingError("This ballot is no longer current.", 409);
    // A lost acknowledgement remains recoverable after closing or switching candidates.
    if (initial && r.initial[m.id]) return {ok: true};
    if (!initial && r.votes[m.id]) return {ok: true, submissionId: r.votes[m.id].id};
    if (!config.password || doc.exportPending || candidateId !== doc.current || !(initial ? ["initial"] : ["revision", "final"]).includes(doc.phase)) throw new VotingError(initial ? "Initial ratings have closed for this candidate." : "Final submissions are not currently open.", 409);
    if (!(r.roster || doc.roster)?.includes(m.id)) throw new VotingError("You joined after this candidate started.", 409);
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
      doc.roster ||= doc.members.filter(m => m.role === "voter").map(m => m.id);
      doc.rounds[selected.id] = {version, initial: {}, initialRatings: {}, roster: doc.members.filter(m => m.role === "voter").map(m => m.id), votes: {}};
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
    try { await exportCandidate(config, doc, pending.candidateId); }
    catch { throw new VotingError("Votes are saved in Redis. Export to Sheets failed. Retry the export before continuing.", 503, 2); }
    await change(config, latest => {
      if (latest.exportPending?.id !== pending.id) return;
      latest.candidates.find(c => c.id === pending.candidateId)!.completed = true;
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
  await writeSummary(config.sheetId, doc.candidates, doc.criteria, meta.sheets.find(s => s.properties.title === "Summary")!.properties.sheetId);
  await polishElectionSheet(config.sheetId, meta.sheets, doc.criteria.length);

}

async function markRedis(config: Settings) {
  const metadata = await sheets<{sheets: {properties: {title: string}}[]}>(config.sheetId, "?fields=sheets.properties.title", "GET", undefined, true);
  if (!metadata.sheets.some(s => s.properties.title === "Session")) await sheets(config.sheetId, ":batchUpdate", "POST", {requests: [{addSheet: {properties: {title: "Session"}}}]});
  const [rows] = await readRanges(config.sheetId, ["'Session'!A1:B20"], true);
  if (rows.length && (rows[0]?.[0] !== "key" || rows[0]?.[1] !== "value")) throw new VotingError("Restore the Session tab headers.", 409);
  const runtime = Object.fromEntries(rows.slice(1).filter(r => r[0]).map(r => [r[0], r[1] || ""])) as Record<string, string>;
  await writeRanges(config.sheetId, [{range: "'Session'!A1", values: [["key", "value"], ...Object.entries({...runtime, session_id: config.sessionId, storage_backend: "redis"})]}]);
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
  if (m.role !== "voter") throw new VotingError("Admins do not vote.", 403);
  const round = Object.hasOwn(doc.rounds, candidateId) ? doc.rounds[candidateId] : undefined;
  if (!round || round.version !== version) throw new VotingError("This ballot is no longer available.", 409);
  const vote = round.votes[m.id];
  return {initialRatings: round.initialRatings?.[m.id] || vote?.initial || null, finalRatings: vote?.final || null, submissionId: vote?.id || null};
}
