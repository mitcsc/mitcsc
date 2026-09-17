import { randomUUID } from "node:crypto";
import { Identity, VotingError } from "./security";
import { sheets } from "./sheets";
import type { Settings } from "./service";
const HEADERS = ["session_id", "election_sheet_id", "claim_id", "voter_id", "voter_name", "claimed_at"];
async function claims(config: Settings, fresh = false): Promise<string[][]> {
  const result = await sheets<{ values?: string[][] }>(config.settingsSheetId, `/values/${encodeURIComponent("'Admins'!A:F")}`, "GET", undefined, fresh);
  const rows = (result.values || []).map(row => row.map(String));
  if (HEADERS.some((header, i) => rows[0]?.[i] !== header)) throw new VotingError("Restore the Admins tab headers in the settings spreadsheet.", 409);
  return rows.slice(1).filter(row => row[0] === config.sessionId && row[1] === config.sheetId);
}
async function ensureClaims(config: Settings) {
  const suffix = "?fields=sheets.properties.title";
  type Metadata = { sheets: { properties: { title: string } }[] };
  const exists = (data: Metadata) => data.sheets.some(sheet => sheet.properties.title === "Admins");
  const metadata = await sheets<Metadata>(config.settingsSheetId, suffix);
  if (exists(metadata)) return;
  try {
    // Header and tab creation are one atomic Sheets batch, avoiding a race with the first claim.
    const sheetId = Math.floor(Math.random() * 1_000_000_000) + 1;
    await sheets(config.settingsSheetId, ":batchUpdate", "POST", { requests: [
      { addSheet: { properties: { title: "Admins", sheetId, hidden: true } } },
      { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: [{ values: HEADERS.map(stringValue => ({ userEnteredValue: { stringValue } })) }], fields: "userEnteredValue" } },
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
  await sheets(config.settingsSheetId, `/values/${encodeURIComponent("'Admins'!A:F")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, "POST", {
    values: [[config.sessionId, config.sheetId, claimId, id, name, new Date().toISOString()]],
  });
  // Google append order is authoritative, including simultaneous joins on separate app instances.
  const first = (await claims(config, true))[0];
  return { id, name: sameSession ? existing.name : name, sessionId: config.sessionId, sheetId: config.sheetId, role: first?.[2] === claimId && first?.[3] === id ? "admin" : "voter", claimId, exp: Date.now() + 24 * 3600_000 };
}
