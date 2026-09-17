import { randomInt, randomUUID } from "node:crypto";
import { Identity, VotingError, text } from "./security";
import { invalidate, readRanges, sheets, writeRanges } from "./sheets";
import type { Candidate, Criterion, FinalBallot, Ratings, VotingPhase, VotingState } from "./types";

const HEADERS = {
  Candidates: ["id", "name", "context", "order", "completed"],
  Criteria: ["id", "label", "description", "min", "max", "required"],
  Responses: ["submission_id", "session_id", "candidate_id", "candidate_name", "voter_id", "voter_name", "ballot_version", "criterion_id", "criterion_label", "initial_rating", "final_rating", "submitted_at"],
  Session: ["key", "value"],
  Ballots: ["candidate_id", "ballot_version", "candidate_name", "candidate_context", "criteria_json"],
  Summary: ["session_id", "candidate_id", "candidate_name", "criterion", "initial_average", "final_average", "ratings_count"],
};
const PHASES: VotingPhase[] = ["waiting", "initial", "deliberation", "revision", "final", "locked"];
export interface Settings { sessionId: string; password: string; sheetId: string; settingsSheetId: string }
export async function settings(): Promise<Settings> {
  const id = process.env.VOTING_SETTINGS_SHEET_ID || "1CRZtuOwF7iouzHrj_n5TCofcNtCtzfBQvsa8Ez9wLXQ";
  if (!id) throw new VotingError("Voting is not configured. Set VOTING_SETTINGS_SHEET_ID and share the settings sheet with the service account.", 503);
  const [rows] = await readRanges(id, ["'Settings'!A:B"]);
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
interface Snapshot { initialized: boolean; candidates: Candidate[]; criteria: Criterion[]; runtime: Record<string, string>; responses: string[][]; ballots: string[][] }
async function tabNames(id: string) {
  const meta = await sheets<{ sheets: { properties: { title: string } }[] }>(id, "?fields=sheets.properties.title");
  return meta.sheets.map(s => s.properties.title);
}
function checkHeaders(name: keyof typeof HEADERS, rows: string[][]) {
  if (HEADERS[name].some((value, i) => rows[0]?.[i] !== value)) throw new VotingError(`The ${name} tab has unexpected columns. Restore its original headers before continuing.`, 409);
}
async function snapshot(config: Settings, fresh = false): Promise<Snapshot> {
  const names = await tabNames(config.sheetId);
  if (Object.keys(HEADERS).some(name => !names.includes(name))) return { initialized: false, candidates: [], criteria: [], runtime: {}, responses: [], ballots: [] };
  const tables = await readRanges(config.sheetId, ["'Candidates'!A1:E102", "'Criteria'!A1:F22", "'Session'!A1:B20", "'Responses'!A:L", "'Ballots'!A:E"], fresh);
  (["Candidates", "Criteria", "Session", "Responses", "Ballots"] as const).forEach((name, i) => checkHeaders(name, tables[i]));
  const candidates = tables[0].slice(1).filter(r => r[0]).map(r => ({ id: r[0], name: r[1] || "", context: r[2] || "", order: Number(r[3]), completed: r[4]?.toLowerCase() === "true" })).sort((a, b) => a.order - b.order);
  const criteria = tables[1].slice(1).filter(r => r[0]).map(r => ({ id: r[0], label: r[1] || "", description: r[2] || "", min: Number(r[3]), max: Number(r[4]), required: r[5]?.toLowerCase() !== "false" }));
  return { initialized: true, candidates, criteria, runtime: Object.fromEntries(tables[2].slice(1).filter(r => r[0]).map(r => [r[0], r[1] || ""])), responses: tables[3].slice(1).filter(r => r[0]), ballots: tables[4].slice(1).filter(r => r[0]) };
}
function phase(s: Snapshot): VotingPhase { return PHASES.includes(s.runtime.phase as VotingPhase) ? s.runtime.phase as VotingPhase : "waiting"; }
function ballotCriteria(s: Snapshot): Criterion[] {
  if (!s.runtime.criteria_json) return s.criteria;
  try { return JSON.parse(s.runtime.criteria_json); } catch { throw new VotingError("The saved ballot is damaged. Contact the admin.", 409); }
}
function state(config: Settings, identity: Identity, s: Snapshot): VotingState {
  if (s.runtime.session_id && s.runtime.session_id !== config.sessionId) throw new VotingError("This spreadsheet belongs to another session. Use a new election spreadsheet or restore its session ID.", 409);
  const admin = identity.role === "admin";
  const found = s.candidates.find(c => c.id === s.runtime.candidate_id) || null;
  const current = found && s.runtime.ballot_version ? { ...found, name: s.runtime.candidate_name || found.name, context: s.runtime.candidate_context || "" } : found;
  const visible = s.runtime.context_visible === "true";
  return { sessionId: config.sessionId, active: !!config.password, phase: phase(s), ballotVersion: s.runtime.ballot_version || "", currentCandidate: current ? { ...current, context: admin || visible ? current.context : "" } : null, criteria: ballotCriteria(s), contextVisible: visible, submittedCount: new Set(s.responses.filter(r => r[1] === config.sessionId && r[2] === current?.id && r[6] === s.runtime.ballot_version).map(r => r[4])).size, voter: { id: identity.id, name: identity.name }, isAdmin: admin, initialized: s.initialized, ...(admin ? { candidates: s.candidates, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${config.sheetId}/edit` } : {}) };
}
export async function getState(config: Settings, identity: Identity) { return state(config, identity, await snapshot(config)); }
async function saveRuntime(config: Settings, runtime: Record<string, string>) {
  await writeRanges(config.sheetId, [{ range: "'Session'!A1:B20", values: [HEADERS.Session, ...Object.entries(runtime), ...Array.from({ length: Math.max(0, 19 - Object.keys(runtime).length) }, () => ["", ""])] }]);
}
function validateSetup(candidates: Candidate[], criteria: Criterion[]) {
  if (!Array.isArray(candidates) || candidates.length > 100 || !Array.isArray(criteria) || criteria.length > 20) throw new VotingError("Use at most 100 candidates and 20 criteria.");
  for (const c of candidates) {
    if (!c || typeof c !== "object") throw new VotingError("Invalid candidate details.");
    text(c.id, "candidate ID", 100); text(c.name, "candidate name", 150);
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
export async function adminAction(config: Settings, identity: Identity, input: Record<string, unknown>) {
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
      return getState(config, identity);
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
    } else if (input.action === "shuffle") {
      const remaining = s.candidates.filter(c => !c.completed && c.id !== current?.id);
      for (let i = remaining.length - 1; i > 0; i--) { const j = randomInt(i + 1); [remaining[i], remaining[j]] = [remaining[j], remaining[i]]; }
      let index = 0;
      const result = s.candidates.map(c => c.completed || c.id === current?.id ? c : remaining[index++]);
      await writeRanges(config.sheetId, [{ range: "'Candidates'!A2", values: result.map((c, i) => [c.id, c.name, c.context, i, c.completed]) }]);
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
        if (!["waiting", "locked"].includes(phase(s))) throw new VotingError("Lock the current candidate before opening another ballot.", 409);
        const selected = s.candidates.find(c => c.id === (input.candidateId || current?.id));
        if (!selected || selected.completed) throw new VotingError("Choose an unfinished candidate.", 409);
        validateSetup(s.candidates, s.criteria);
        if (!s.criteria.length) throw new VotingError("Add at least one criterion.");
        let saved = s.ballots.find(b => b[0] === selected.id);
        if (!saved) {
          saved = [selected.id, randomUUID(), selected.name, selected.context, JSON.stringify(s.criteria)];
          await sheets(config.sheetId, `/values/${encodeURIComponent("'Ballots'!A:E")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, "POST", { values: [saved] });
        }
        await saveRuntime(config, { ...s.runtime, phase: next, candidate_id: saved[0], candidate_name: saved[2], candidate_context: saved[3], ballot_version: saved[1], criteria_json: saved[4], context_visible: "false" });
      } else if (next === "waiting" && ["waiting", "locked"].includes(phase(s)) && input.candidateId) {
        const selected = s.candidates.find(c => c.id === input.candidateId);
        if (!selected || selected.completed) throw new VotingError("Choose an unfinished candidate.", 409);
        await saveRuntime(config, { ...s.runtime, phase: "waiting", candidate_id: selected.id, candidate_name: "", candidate_context: "", ballot_version: "", criteria_json: "", context_visible: "false" });
      } else {
        const allowed: Record<VotingPhase, VotingPhase[]> = { waiting: [], initial: ["deliberation", "revision", "final", "locked"], deliberation: ["revision", "final", "locked"], revision: ["deliberation", "final", "locked"], final: ["locked"], locked: [] };
        if (next !== phase(s) && !allowed[phase(s)].includes(next)) throw new VotingError("That phase change is not available.", 409);
        if (next === "locked" && current) await writeRanges(config.sheetId, [{ range: "'Candidates'!A2", values: s.candidates.map(c => [c.id, c.name, c.context, c.order, c.completed || c.id === current.id]) }]);
        await saveRuntime(config, { ...s.runtime, phase: next });
      }
    } else throw new VotingError("Unknown admin action.");
    return getState(config, identity);
  });
}
export async function submit(config: Settings, identity: Identity, input: Record<string, unknown>) {
  return serialize(async () => {
    const id = text(input.submissionId, "submission ID", 100);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new VotingError("Invalid submission ID.");
    invalidate(config.sheetId);
    const s = await snapshot(config, true);
    state(config, identity, s);
    const ballot = input as unknown as FinalBallot;
    if (ballot.sessionId !== config.sessionId) throw new VotingError("This ballot belongs to another session.", 409);
    const existing = s.responses.find(r => r[1] === config.sessionId && r[2] === ballot.candidateId && r[4] === identity.id && r[6] === ballot.ballotVersion);
    if (existing) return { ok: true, submissionId: existing[0] };
    if (!config.password || phase(s) !== "final") throw new VotingError("Final submissions are not currently open.", 409);
    if (ballot.sessionId !== config.sessionId || ballot.candidateId !== s.runtime.candidate_id || ballot.ballotVersion !== s.runtime.ballot_version) throw new VotingError("This ballot is no longer current. Keep your draft and contact the admin.", 409);
    const criteria = ballotCriteria(s);
    validateRatings(ballot.initialRatings, criteria); validateRatings(ballot.finalRatings, criteria);
    const submittedAt = new Date().toISOString();
    await sheets(config.sheetId, `/values/${encodeURIComponent("'Responses'!A:L")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, "POST", { values: criteria.map(c => [id, config.sessionId, ballot.candidateId, s.runtime.candidate_name || "", identity.id, identity.name, ballot.ballotVersion, c.id, c.label, ballot.initialRatings[c.id] ?? "", ballot.finalRatings[c.id] ?? "", submittedAt]) });
    return { ok: true, submissionId: id };
  });
}
