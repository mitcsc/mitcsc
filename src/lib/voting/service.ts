import { presidentEnabled } from "./president";
import { redisEnabled } from "./redis";
import { redisSettings, redisState, redisAdminAction, redisSubmit, redisRecoverBallot } from "./redis-service";
import { sessionVoters } from "./admin-identity";
import { randomUUID } from "node:crypto";
import { Identity, VotingError, text } from "./security";
import { invalidate, invalidateMetadata, readControlSheet, readRanges, sheets, writeRanges } from "./sheets";
import type { Candidate, Criterion, FinalBallot, Ratings, VotingPhase, VotingState } from "./types";

export const HEADERS = {
  Candidates: ["id", "name", "context", "order", "completed"],
  Criteria: ["id", "label", "description", "min", "max", "required"],
  Responses: ["submission_id", "session_id", "candidate_id", "candidate_name", "voter_id", "voter_name", "ballot_version", "criterion_id", "criterion_label", "initial_rating", "final_rating", "submitted_at"],
  Session: ["key", "value"],
  Ballots: ["candidate_id", "ballot_version", "candidate_name", "candidate_context", "criteria_json"],
  Summary: ["session_id", "candidate_id", "candidate_name", "criterion", "initial_average", "final_average", "ratings_count"],
};
const PHASES: VotingPhase[] = ["waiting", "initial", "deliberation", "revision", "final", "locked"];
export interface Settings { sessionId: string; password: string; sheetId: string; settingsSheetId: string; name?: string; presidentManaged?: boolean }
export async function sheetSettings(fresh = false): Promise<Settings> {
  const id = process.env.VOTING_SETTINGS_SHEET_ID || "1CRZtuOwF7iouzHrj_n5TCofcNtCtzfBQvsa8Ez9wLXQ";
  if (!id) throw new VotingError("Voting is not configured. Set VOTING_SETTINGS_SHEET_ID and share the settings sheet with the service account.", 503);
  const rows = fresh ? (await readRanges(id, ["'Settings'!A:B"], true))[0] : (await readControlSheet(id, false, 120_000)).settings;
  const values = Object.fromEntries(rows.map(row => [row[0]?.trim(), row[1] || ""]));
  const raw = values.voting_sheet_url || "";
  const sheetId = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] || (/^[a-zA-Z0-9_-]{15,}$/.test(raw) ? raw : "");
  if (!values.session_id || !sheetId) throw new VotingError("Complete session_id and voting_sheet_url in the settings sheet.", 503);
  return { sessionId: values.session_id, password: values.session_password || "", sheetId, settingsSheetId: id };
}
export function authorize(identity: Identity | null, config: Settings, admin = false): Identity {
  if (!identity || identity.sessionId !== config.sessionId || identity.sheetId !== config.sheetId) throw new VotingError("Enter the session password to join.", 401);
  if (admin && identity.role !== "admin") throw new VotingError("Admin access required.", 403);
  return identity;
}
interface Snapshot { initialized: boolean; candidates: Candidate[]; criteria: Criterion[]; runtime: Record<string, string>; responses: string[][]; ballots: string[][]; receipts: string[][] }
async function tabNames(id: string) {
  const meta = await sheets<{ sheets: { properties: { title: string } }[] }>(id, "?fields=sheets.properties.title");
  return meta.sheets.map(s => s.properties.title);
}
function checkHeaders(name: keyof typeof HEADERS, rows: string[][]) {
  if (HEADERS[name].some((value, i) => rows[0]?.[i] !== value)) throw new VotingError(`The ${name} tab has unexpected columns. Restore its original headers before continuing.`, 409);
}
export async function snapshot(config: Settings, fresh = false, admin = true): Promise<Snapshot> {
  // Once initialized, the Session row contains everything a voter needs for an open ballot.
  // A cold instance checks structure once; subsequent checks reuse metadata until a structural write.
  const names = await tabNames(config.sheetId);
  if (!names.includes(INITIAL_TAB) || Object.keys(HEADERS).some(name => !names.includes(name))) invalidateMetadata(config.sheetId);
  if (Object.keys(HEADERS).some(name => !names.includes(name))) return { initialized: false, candidates: [], criteria: [], runtime: {}, responses: [], ballots: [], receipts: [] };
  if (!admin && !fresh) {
    const [rows] = await readRanges(config.sheetId, ["'Session'!A1:B20"]);
    checkHeaders("Session", rows);
    const runtime = Object.fromEntries(rows.slice(1).filter(r => r[0]).map(r => [r[0], r[1] || ""]));
    if (runtime.row_layout_json && runtime.ballot_version) {
      const candidate: Candidate = {id: runtime.candidate_id, name: runtime.candidate_name || "", context: runtime.candidate_context || "", order: 0, completed: runtime.phase === "locked"};
      return {initialized: true, runtime, candidates: runtime.candidate_id ? [candidate] : [], criteria: (JSON.parse(runtime.row_layout_json) as RowLayout).criteria, responses: [], ballots: [], receipts: []};
    }
  }
  // Admin reads combine definitions and counts. Voters use frozen data once a ballot starts.
  const definitions = ["'Candidates'!A1:E102", "'Criteria'!A1:F22"];
  const ranges = ["'Session'!A1:B20", ...(admin ? ["'Responses'!A:L", "'Ballots'!A:E", ...(names.includes(INITIAL_TAB) ? [`'${INITIAL_TAB}'!A:E`] : [])] : [])];
  const combined = fresh || admin ? await readRanges(config.sheetId, [...definitions, ...ranges], true) : undefined;
  const definition = combined ? combined.slice(0, 2) : await readRanges(config.sheetId, definitions, false, 60_000);
  // Admin polls every eight seconds. Read counts fresh so cache age does not add another delay.
  // Voter stage polls retain their shared five-second cache.
  const live = combined ? combined.slice(2) : await readRanges(config.sheetId, ranges, admin);
  const tables = [...definition, ...live];
  (["Candidates", "Criteria", "Session"] as const).forEach((name, i) => checkHeaders(name, tables[i]));
  if (admin) {
    checkHeaders("Responses", tables[3]); checkHeaders("Ballots", tables[4]);
    if (tables[5] && INITIAL_HEADERS.some((header, i) => tables[5][0]?.[i] !== header)) throw new VotingError("The Initial submissions tab has unexpected columns.", 409);
  }
  const candidates = tables[0].slice(1).filter(r => r[0]).map(r => ({ id: r[0], name: r[1] || "", context: r[2] || "", order: Number(r[3]), completed: r[4]?.toLowerCase() === "true" })).sort((a, b) => a.order - b.order);
  const criteria = tables[1].slice(1).filter(r => r[0]).map(r => ({ id: r[0], label: r[1] || "", description: r[2] || "", min: Number(r[3]), max: Number(r[4]), required: r[5]?.toLowerCase() !== "false" }));
  return { initialized: true, candidates, criteria, runtime: Object.fromEntries(tables[2].slice(1).filter(r => r[0]).map(r => [r[0], r[1] || ""])), responses: tables[3]?.slice(1).filter(r => r[0]) || [], ballots: tables[4]?.slice(1).filter(r => r[0]) || [], receipts: tables[5]?.slice(1).filter(r => r[0]) || [] };
}
function phase(s: Snapshot): VotingPhase { return PHASES.includes(s.runtime.phase as VotingPhase) ? s.runtime.phase as VotingPhase : "waiting"; }
function ballotCriteria(s: Snapshot): Criterion[] {
  if (!s.runtime.criteria_json) return s.criteria;
  try { return JSON.parse(s.runtime.criteria_json); } catch { throw new VotingError("The saved ballot is damaged. Contact the admin.", 409); }
}
function state(config: Settings, identity: Identity, s: Snapshot): VotingState {
  if (s.runtime.storage_backend === "redis") throw new VotingError("This election uses Redis. Restore its Redis connection before continuing.", 503);
  if (s.runtime.session_id && s.runtime.session_id !== config.sessionId) throw new VotingError("This spreadsheet belongs to another session. Use a new election spreadsheet or restore its session ID.", 409);
  const admin = identity.role === "admin";
  const found = s.candidates.find(c => c.id === s.runtime.candidate_id) || null;
  const current = found && s.runtime.ballot_version ? { ...found, name: s.runtime.candidate_name || found.name, context: s.runtime.candidate_context || "" } : found;
  const visible = s.runtime.context_visible === "true";
  return { sessionId: config.sessionId, active: !!config.password, votingStarted: s.runtime.voting_started === "true" || s.ballots.length > 0 || !!s.runtime.ballot_version || s.candidates.some(candidate => candidate.completed) || phase(s) !== "waiting", phase: phase(s), ballotVersion: s.runtime.ballot_version || "", currentCandidate: current ? { ...current, context: admin || visible ? current.context : "" } : null, criteria: ballotCriteria(s), contextVisible: visible, submittedCount: new Set(s.responses.filter(r => r[1] === config.sessionId && r[2] === current?.id && r[6] === s.runtime.ballot_version).map(r => r[4])).size, voter: { id: identity.id, name: identity.name }, isAdmin: admin, initialized: s.initialized, ...(admin ? { candidates: s.candidates, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${config.sheetId}/edit` } : {}) };
}
const INITIAL_TAB = "Initial submissions";
const INITIAL_HEADERS = ["session_id", "candidate_id", "ballot_version", "voter_id", "submitted_at"];
async function ensureInitialTab(config: Settings) {
    if (!(await tabNames(config.sheetId)).includes(INITIAL_TAB)) {
      await sheets(config.sheetId, ":batchUpdate", "POST", {requests: [{addSheet: {properties: {title: INITIAL_TAB}}}]});
      await writeRanges(config.sheetId, [{range: `'${INITIAL_TAB}'!A1`, values: [INITIAL_HEADERS]}]);
    }
}
const VOTER_CAPACITY = 128;
interface RowLayout { candidates: string[]; criteria: Criterion[] }
async function prepareFixedRows(config: Settings, s: Snapshot) {
  const meta = await sheets<{sheets: {properties: {sheetId: number; title: string; gridProperties: {rowCount: number}}}[]}>(config.sheetId, "?fields=sheets.properties(sheetId,title,gridProperties.rowCount)");
  const requests = ["Responses", INITIAL_TAB].flatMap(title => {
    const sheet = meta.sheets.find(sheet => sheet.properties.title === title)!;
    const needed = 1 + s.candidates.length * VOTER_CAPACITY * (title === "Responses" ? s.criteria.length : 1);
    return (sheet.properties.gridProperties?.rowCount || 0) < needed ? [{updateSheetProperties: {properties: {sheetId: sheet.properties.sheetId, gridProperties: {rowCount: needed}}, fields: "gridProperties.rowCount"}}] : [];
  });
  if (requests.length) await sheets(config.sheetId, ":batchUpdate", "POST", {requests});
  s.runtime.row_layout_json = JSON.stringify({candidates: s.candidates.map(candidate => candidate.id), criteria: s.criteria} satisfies RowLayout);
  s.runtime.voters_json = JSON.stringify(await sessionVoters(config, true));
}

async function writeAdmittedBallot(config: Settings, data: Parameters<typeof writeRanges>[1]) {
  for (let attempt = 0; ; attempt++) {
    try { return await writeRanges(config.sheetId, data); }
    catch (error) {
      if (!(error instanceof VotingError) || error.status !== 429 || attempt >= 3) throw error;
      // Keep admission while the quota recovers. Closing does not cancel an accepted write.
      await new Promise(resolve => setTimeout(resolve, (2 ** attempt * 1000) + Math.random() * 1000));
    }
  }
}

async function fixedSubmission(config: Settings, identity: Identity, input: Record<string, unknown>, initial: boolean) {
  // Only layout discovery is cached. Admission always reads the authoritative stage.
  const [cachedRuntime] = await readRanges(config.sheetId, ["'Session'!A1:B20"]);
  const cached = Object.fromEntries(cachedRuntime.slice(1));
  if (!cached.row_layout_json) return null; // Preserve existing elections in their original append format.
  if (input.sessionId !== config.sessionId) throw new VotingError("This ballot belongs to another session.", 409);
  const layout: RowLayout = JSON.parse(cached.row_layout_json);
  const candidateIndex = layout.candidates.indexOf(String(input.candidateId));
  const stride = layout.criteria.length;
  const slot = identity.voterSlot ?? (await sessionVoters(config)).findIndex(voter => voter.id === identity.id);
  if (candidateIndex < 0 || !Number.isInteger(slot) || slot < 0 || slot >= VOTER_CAPACITY) throw new VotingError("This voter has no ballot slot. Sessions support up to 128 voters.", 409);
  const index = candidateIndex * VOTER_CAPACITY + slot;
  const responseRow = 2 + index * stride;
  const receiptRow = 2 + index;
  // A single bounded read checks admission and recovers a lost acknowledgement.
  const [runtimeRows, existingRows] = await readRanges(config.sheetId, ["'Session'!A1:B20", initial ? `'${INITIAL_TAB}'!A${receiptRow}:E${receiptRow}` : `'Responses'!A${responseRow}:L${responseRow + stride - 1}`], true);
  const runtime = Object.fromEntries(runtimeRows.slice(1));
  if (runtime.row_layout_json !== cached.row_layout_json) throw new VotingError("The ballot layout changed. Refresh before submitting.", 409);
  if (runtime.session_id !== config.sessionId) throw new VotingError("This spreadsheet belongs to another session.", 409);
  const existing = existingRows.find(row => initial ? row[0] === config.sessionId && row[1] === input.candidateId && row[2] === input.ballotVersion && row[3] === identity.id : row[1] === config.sessionId && row[2] === input.candidateId && row[4] === identity.id && row[6] === input.ballotVersion);
  if (existing) return initial ? {ok: true} : {ok: true, submissionId: existing[0]};
  if (existingRows.some(row => row.some(Boolean))) throw new VotingError("The reserved ballot rows were changed. Ask the admin to check the spreadsheet.", 409);
  if (!config.password || runtime.candidate_id !== input.candidateId || runtime.ballot_version !== input.ballotVersion || !(initial ? ["initial"] : ["revision", "final"]).includes(runtime.phase)) throw new VotingError(initial ? "Initial ratings have closed for this candidate." : "Final submissions are not currently open.", 409);
  const criteria = layout.criteria;
  const submittedAt = new Date().toISOString();
  if (initial) {
    validateRatings(input.ratings, criteria);
    await writeAdmittedBallot(config, [{range: `'${INITIAL_TAB}'!A${receiptRow}`, values: [[config.sessionId, String(input.candidateId), String(input.ballotVersion), identity.id, submittedAt]]}]);
    return {ok: true};
  }
  const ballot = input as unknown as FinalBallot;
  const id = text(ballot.submissionId, "submission ID", 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new VotingError("Invalid submission ID.");
  validateRatings(ballot.initialRatings, criteria); validateRatings(ballot.finalRatings, criteria);
  // Admission has succeeded. A close may happen while this write is in flight; it must finish.
  // Repeating a write targets the same cells, so an ambiguous network result cannot add a second ballot.
  await writeAdmittedBallot(config, [{range: `'Responses'!A${responseRow}`, values: criteria.map(c => [id, config.sessionId, ballot.candidateId, runtime.candidate_name || "", identity.id, identity.name, ballot.ballotVersion, c.id, c.label, ballot.initialRatings[c.id] ?? "", ballot.finalRatings[c.id] ?? "", submittedAt])}]);
  return {ok: true, submissionId: id};
}

export async function sheetSubmitInitial(config: Settings, identity: Identity, input: Record<string, unknown>) {
  if (identity.role === "admin") throw new VotingError("Admins do not vote.", 403);
  return serialize(async () => {
    const fixed = await fixedSubmission(config, identity, input, true);
    if (fixed) return fixed;
    const s = await snapshot(config, true);
    state(config, identity, s);
    if (input.sessionId !== config.sessionId) throw new VotingError("This ballot belongs to another session.", 409);
    const receipts = s.receipts;
    if (receipts.some(r => r[0] === config.sessionId && r[1] === input.candidateId && r[2] === input.ballotVersion && r[3] === identity.id)) return {ok: true};
    if (!s.initialized || !config.password || phase(s) !== "initial" || !s.runtime.ballot_version || input.candidateId !== s.runtime.candidate_id || input.ballotVersion !== s.runtime.ballot_version) throw new VotingError("Initial ratings have closed for this candidate.", 409);
    validateRatings(input.ratings, ballotCriteria(s));
    await ensureInitialTab(config);
    await sheets(config.sheetId, `/values/${encodeURIComponent(`'${INITIAL_TAB}'!A:E`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, "POST", {values: [[config.sessionId, input.candidateId, input.ballotVersion, identity.id, new Date().toISOString()]]});
    return {ok: true};
  });
}
export async function sheetState(config: Settings, identity: Identity) {
  const s = await snapshot(config, false, identity.role === "admin");
  const result = state(config, identity, s);
  if (identity.role === "admin") {
    const submitted = new Set(s.responses.filter(r => r[1] === config.sessionId && r[2] === result.currentCandidate?.id && r[6] === result.ballotVersion).map(r => r[4]));
    const initial = new Set(s.receipts.filter(r => r[0] === config.sessionId && r[1] === result.currentCandidate?.id && r[2] === result.ballotVersion).map(r => r[3]));
    const frozenVoters: {id: string; name: string}[] | undefined = s.runtime.voters_json ? JSON.parse(s.runtime.voters_json) : undefined;
    const voters = frozenVoters || await sessionVoters(config);
    result.participants = voters.map(voter => ({...voter, submitted: submitted.has(voter.id), initialSubmitted: initial.has(voter.id)}));
    const receipts = s.receipts;
    result.candidateStates = s.candidates.map(candidate => {
      const ballot = [...s.ballots].reverse().find(row => row[0] === candidate.id);
      const version = candidate.id === result.currentCandidate?.id ? result.ballotVersion : ballot?.[1] || "";
      const finalVoters = new Set(s.responses.filter(r => r[1] === config.sessionId && r[2] === candidate.id && r[6] === version).map(r => r[4]));
      const initialVoters = new Set(receipts.filter(r => r[0] === config.sessionId && r[1] === candidate.id && r[2] === version).map(r => r[3]));
      return {candidateId: candidate.id, phase: candidate.id === result.currentCandidate?.id ? result.phase : candidate.completed ? "locked" as const : "waiting" as const, ballotVersion: version, submittedCount: finalVoters.size, participants: voters.map(voter => ({...voter, submitted: finalVoters.has(voter.id), initialSubmitted: initialVoters.has(voter.id)}))};
    });
  }
  return result;
}
async function saveRuntime(config: Settings, runtime: Record<string, string>) {
  if (runtime.ballot_version) runtime.voting_started = "true";
  await writeRanges(config.sheetId, [{ range: "'Session'!A1:B20", values: [HEADERS.Session, ...Object.entries(runtime), ...Array.from({ length: Math.max(0, 19 - Object.keys(runtime).length) }, () => ["", ""])] }]);
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
// Serializes mutations within this process. Sheets is not transactional across instances.
let mutation = Promise.resolve();
export async function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutation.then(operation, operation);
  mutation = next.then(() => undefined, () => undefined);
  return next;
}
export async function sheetAdminAction(config: Settings, identity: Identity, input: Record<string, unknown>) {
  return serialize(async () => {
    invalidate(config.sheetId);
    if (input.action === "initialize") {
      const names = await tabNames(config.sheetId);
      const missing = Object.keys(HEADERS).filter(n => !names.includes(n));
      // Validate every existing reserved tab before creating anything.
      const existing = Object.keys(HEADERS).filter(n => names.includes(n)) as (keyof typeof HEADERS)[];
      if (existing.length) {
        const rows = await readRanges(config.sheetId, existing.map(n => `'${n}'!A1:L2`));
        rows.forEach((r, i) => { if (r.length) checkHeaders(existing[i], r); });
      }
      if (missing.length) await sheets(config.sheetId, ":batchUpdate", "POST", { requests: missing.map(title => ({ addSheet: { properties: { title } } })) });
      for (const name of Object.keys(HEADERS) as (keyof typeof HEADERS)[]) {
        const [rows] = await readRanges(config.sheetId, [`'${name}'!A1:L2`]);
        if (!rows.length) await writeRanges(config.sheetId, [{ range: `'${name}'!A1`, values: [HEADERS[name]] }]);
      }
      const s = await snapshot(config, true);
      if (!s.runtime.session_id) await saveRuntime(config, { session_id: config.sessionId, phase: "waiting", candidate_id: "", ballot_version: "", context_visible: "false", criteria_json: "" });
      // Formula stays in Summary only; all user-controlled values use RAW writes.
      const [summary] = await readRanges(config.sheetId, ["'Summary'!A2:G2"]);
      if (!summary.length) await sheets(config.sheetId, "/values:batchUpdate", "POST", { valueInputOption: "USER_ENTERED", data: [{ range: "'Summary'!A2", values: [[`=IFERROR(QUERY(UNIQUE(Responses!B2:K),"select Col1,Col2,Col3,Col8,avg(Col9),avg(Col10),count(Col10) where Col1 is not null group by Col1,Col2,Col3,Col8 label Col1 '',Col2 '',Col3 '',Col8 '',avg(Col9) '',avg(Col10) '',count(Col10) ''",0),"")`]] }] });
      return sheetState(config, identity);
    }
    const s = await snapshot(config, true);
    state(config, identity, s);
    if (!s.initialized) throw new VotingError("Set up this election first.", 409);
    const current = s.candidates.find(c => c.id === s.runtime.candidate_id);
    if (input.action === "saveSetup") {
      if (phase(s) !== "waiting" || s.responses.length || s.runtime.ballot_version || s.ballots.length || s.candidates.some(c => c.completed)) throw new VotingError("Setup can only change before the first ballot opens.", 409);
      const candidates = input.candidates as Candidate[], criteria = input.criteria as Criterion[];
      validateSetup(candidates, criteria);
      await writeRanges(config.sheetId, [
        { range: "'Candidates'!A2:E101", values: [...candidates.map((c, i) => [c.id, c.name, c.context, i, false]), ...Array.from({ length: 100 - candidates.length }, () => ["", "", "", "", ""])] },
        { range: "'Criteria'!A2:F21", values: [...criteria.map(c => [c.id, c.label, c.description, c.min, c.max, c.required]), ...Array.from({ length: 20 - criteria.length }, () => ["", "", "", "", "", ""])] },
      ]);
    } else if (input.action === "setContext") {
      if (typeof input.visible !== "boolean") throw new VotingError("Invalid context visibility.");
      await saveRuntime(config, { ...s.runtime, context_visible: String(input.visible) });
    } else if (input.action === "setPhase") {
      const next = input.phase as VotingPhase;
      if (!PHASES.includes(next)) throw new VotingError("Invalid voting phase.");
      if (next === "final" && input.candidateId && ["waiting", "locked"].includes(phase(s))) {
        const saved = s.ballots.find(b => b[0] === input.candidateId);
        if (!saved || !s.candidates.some(c => c.id === input.candidateId)) throw new VotingError("That candidate has no saved ballot to reopen.", 409);
        await saveRuntime(config, { ...s.runtime, phase: "final", candidate_id: saved[0], ballot_version: saved[1], candidate_name: saved[2], candidate_context: saved[3], criteria_json: saved[4], context_visible: "true" });
      } else if (next === "initial") {
        await ensureInitialTab(config);
        if (!["waiting", "locked"].includes(phase(s))) throw new VotingError("Lock the current candidate before opening another ballot.", 409);
        const selected = s.candidates.find(c => c.id === (input.candidateId || current?.id));
        if (!selected || selected.completed) throw new VotingError("Choose an unfinished candidate.", 409);
        if (s.runtime.row_layout_json) s.criteria = (JSON.parse(s.runtime.row_layout_json) as RowLayout).criteria;
        validateSetup(s.candidates, s.criteria);
        if (!s.criteria.length) throw new VotingError("Add at least one criterion.");
        let saved = s.ballots.find(b => b[0] === selected.id);
        if (!saved && !s.ballots.length && !s.responses.length) {
          await prepareFixedRows(config, s);
        }
        if (!saved) {
          saved = [selected.id, randomUUID(), selected.name, selected.context, JSON.stringify(s.criteria)];
          await sheets(config.sheetId, `/values/${encodeURIComponent("'Ballots'!A:E")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, "POST", { values: [saved] });
        }
        await saveRuntime(config, { ...s.runtime, phase: next, candidate_id: saved[0], candidate_name: saved[2], candidate_context: saved[3], ballot_version: saved[1], criteria_json: saved[4], context_visible: "false" });
      } else if (next === "waiting" && ["waiting", "locked"].includes(phase(s)) && input.candidateId) {
        const selected = s.candidates.find(c => c.id === input.candidateId);
        if (!selected || selected.completed) throw new VotingError("Choose an unfinished candidate.", 409);
        await saveRuntime(config, { ...s.runtime, phase: "waiting", voting_started: String(s.ballots.length > 0 || s.runtime.voting_started === "true"), candidate_id: selected.id, candidate_name: "", candidate_context: "", ballot_version: "", criteria_json: "", context_visible: "false" });
      } else {
        const allowed: Record<VotingPhase, VotingPhase[]> = { waiting: [], initial: ["deliberation", "revision", "final", "locked"], deliberation: ["revision", "final", "locked"], revision: ["deliberation", "final", "locked"], final: ["locked"], locked: [] };
        if (next !== phase(s) && !allowed[phase(s)].includes(next)) throw new VotingError("That phase change is not available.", 409);
        if (next === "locked" && current) await writeRanges(config.sheetId, [{ range: "'Candidates'!A2", values: s.candidates.map(c => [c.id, c.name, c.context, c.order, c.completed || c.id === current.id]) }]);
        await saveRuntime(config, { ...s.runtime, phase: next });
      }
    } else throw new VotingError("Unknown admin action.");
    return sheetState(config, identity);
  });
}
export async function sheetSubmit(config: Settings, identity: Identity, input: Record<string, unknown>) {
  if (identity.role === "admin") throw new VotingError("Admins do not vote.", 403);
  return serialize(async () => {
    const id = text(input.submissionId, "submission ID", 100);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new VotingError("Invalid submission ID.");
    const fixed = await fixedSubmission(config, identity, input, false);
    if (fixed) return fixed;
    const s = await snapshot(config, true);
    state(config, identity, s);
    const ballot = input as unknown as FinalBallot;
    if (ballot.sessionId !== config.sessionId) throw new VotingError("This ballot belongs to another session.", 409);
    const existing = s.responses.find(r => r[1] === config.sessionId && r[2] === ballot.candidateId && r[4] === identity.id && r[6] === ballot.ballotVersion);
    if (existing) return { ok: true, submissionId: existing[0] };
    if (!config.password || !["revision", "final"].includes(phase(s))) throw new VotingError("Final submissions are not currently open.", 409);
    if (ballot.sessionId !== config.sessionId || ballot.candidateId !== s.runtime.candidate_id || ballot.ballotVersion !== s.runtime.ballot_version) throw new VotingError("This ballot is no longer current. Keep your draft and contact the admin.", 409);
    const criteria = ballotCriteria(s);
    validateRatings(ballot.initialRatings, criteria); validateRatings(ballot.finalRatings, criteria);
    const submittedAt = new Date().toISOString();
    await sheets(config.sheetId, `/values/${encodeURIComponent("'Responses'!A:L")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, "POST", { values: criteria.map(c => [id, config.sessionId, ballot.candidateId, s.runtime.candidate_name || "", identity.id, identity.name, ballot.ballotVersion, c.id, c.label, ballot.initialRatings[c.id] ?? "", ballot.finalRatings[c.id] ?? "", submittedAt]) });
    return { ok: true, submissionId: id };
  });
}

// Keep the demo and pre-Redis deployments compatible. A configured Redis failure never falls back.
export async function settings(): Promise<Settings> { if (presidentEnabled() && !redisEnabled()) throw new VotingError("Redis must be configured for president setup.", 503); return redisEnabled() ? redisSettings() : sheetSettings(); }
export async function getState(config: Settings, identity: Identity) { return redisEnabled() ? redisState(config, identity) : sheetState(config, identity); }
export async function adminAction(config: Settings, identity: Identity, input: Record<string, unknown>) { return redisEnabled() ? redisAdminAction(config, identity, input) : sheetAdminAction(config, identity, input); }
export async function submitInitial(config: Settings, identity: Identity, input: Record<string, unknown>) { return redisEnabled() ? redisSubmit(config, identity, input, true) : sheetSubmitInitial(config, identity, input); }
export async function submit(config: Settings, identity: Identity, input: Record<string, unknown>) { return redisEnabled() ? redisSubmit(config, identity, input, false) : sheetSubmit(config, identity, input); }

export async function recoverBallot(config: Settings, identity: Identity, candidateId: string, version: string) { return redisEnabled() ? redisRecoverBallot(config, identity, candidateId, version) : {initialRatings: null, finalRatings: null, submissionId: null}; }
