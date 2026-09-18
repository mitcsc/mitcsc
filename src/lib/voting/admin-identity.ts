import { randomUUID } from "node:crypto";
import { Identity, VotingError } from "./security";
import { readControlSheet, sheets } from "./sheets";
import type { Settings } from "./service";
const HEADERS = ["session_id", "election_sheet_id", "claim_id", "voter_id", "voter_name", "claimed_at"];
async function claims(config: Settings, fresh = false): Promise<string[][]> {
  const {history} = await readControlSheet(config.settingsSheetId, fresh, 5000);
  const rows = history || [];
  if (HEADERS.some((header, i) => rows[0]?.[i] !== header)) throw new VotingError("Restore the Session History tab headers in the settings spreadsheet.", 409);
  return rows.slice(1).filter(row => row[0] === config.sessionId && row[1] === config.sheetId);
}
async function ensureClaims(config: Settings) {
  const suffix = "?fields=sheets.properties.title";
  type Metadata = { sheets: { properties: { title: string } }[] };
  const exists = (data: Metadata) => data.sheets.some(sheet => sheet.properties.title === "Session History");
  const metadata = await sheets<Metadata>(config.settingsSheetId, suffix);
  if (exists(metadata)) return;
  try {
    // Header and tab creation are one atomic Sheets batch, avoiding a race with the first claim.
    const sheetId = Math.floor(Math.random() * 1_000_000_000) + 1;
    await sheets(config.settingsSheetId, ":batchUpdate", "POST", { requests: [
      { addSheet: { properties: { title: "Session History", sheetId, hidden: true } } },
      { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: [{ values: HEADERS.map(stringValue => ({ userEnteredValue: { stringValue } })) }], fields: "userEnteredValue" } },
      { addProtectedRange: { protectedRange: { range: { sheetId }, description: "App-managed admin ownership", warningOnly: false, editors: { users: [process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!], domainUsersCanEdit: false } } } },
    ] });
  } catch (error) {
    // Another instance may have created it concurrently. Never overwrite its rows.
    if (!exists(await sheets<Metadata>(config.settingsSheetId, suffix, "GET", undefined, true))) throw error;
  }
}
export async function canonicalIdentity(config: Settings, identity: Identity): Promise<Identity> {
  if (identity.role !== "admin") return identity;
  const first = (await claims(config))[0];
  if (!first || first[2] !== identity.claimId || first[3] !== identity.id) return { ...identity, role: "voter" };
  return identity;
}
export async function claimIdentity(config: Settings, name: string, existing: Identity | null): Promise<Identity> {
  const sameSession = existing && existing.sessionId === config.sessionId && existing.sheetId === config.sheetId;
  if (sameSession) return canonicalIdentity(config, existing);
  await ensureClaims(config);
  const id = sameSession ? existing.id : randomUUID();
  const claimId = randomUUID();
  await sheets(config.settingsSheetId, `/values/${encodeURIComponent("'Session History'!A:F")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, "POST", {
    values: [[config.sessionId, config.sheetId, claimId, id, name, new Date().toISOString()]],
  });
  // Google append order is authoritative, including simultaneous joins on separate app instances.
  const registered = await claims(config, true);
  const first = registered[0];
  const voterSlot = [...new Set(registered.slice(1).map(row => row[3]))].indexOf(id);
  if (voterSlot >= 128) throw new VotingError("This session has reached its 128-voter limit.", 409);
  return { voterSlot, id, name: sameSession ? existing.name : name, sessionId: config.sessionId, sheetId: config.sheetId, role: first?.[2] === claimId && first?.[3] === id ? "admin" : "voter", claimId, exp: Date.now() + 24 * 3600_000 };
}

export async function sessionVoters(config: Settings): Promise<{id: string; name: string}[]> {
  const rows = await claims(config);
  const adminId = rows[0]?.[3];
  const voters = new Map<string, {id: string; name: string}>();
  for (const row of rows) if (row[3] && row[3] !== adminId) voters.set(row[3], {id: row[3], name: row[4] || "Voter"});
  return [...voters.values()];
}
