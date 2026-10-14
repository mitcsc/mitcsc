import { SHEETS, google } from "./api";
import { createSpreadsheetFile } from "./drive";

type Cell = string | number;

interface SheetMeta {
  sheets: { properties: { sheetId: number; title: string }; protectedRanges?: { protectedRangeId: number; description?: string }[] }[];
}

const PROTECTION = "Written by the CSC dashboard. Edits here are overwritten.";

function a1(tab: string) {
  return `'${tab.replace(/'/g, "''")}'`;
}

async function meta(spreadsheetId: string) {
  return google<SheetMeta>(`${SHEETS}/${spreadsheetId}`, { query: { fields: "sheets(properties(sheetId,title),protectedRanges(protectedRangeId,description))" } });
}

async function batch(spreadsheetId: string, requests: unknown[]) {
  return google<{ replies: { addSheet?: { properties: { sheetId: number } } }[] }>(`${SHEETS}/${spreadsheetId}:batchUpdate`, { method: "POST", body: { requests } });
}

// Bold, frozen header, and a protected tab so only the club account (the owner) can edit it.
function setupRequests(sheetId: number, ownerEmail: string) {
  return [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: "userEnteredFormat.textFormat.bold" } },
    { addProtectedRange: { protectedRange: { range: { sheetId }, description: PROTECTION, warningOnly: false, editors: { users: [ownerEmail] } } } },
  ];
}

// Creates a spreadsheet in a Drive folder with one protected tab.
export async function createSheet(name: string, folderId: string, tab: string, ownerEmail: string) {
  const file = await createSpreadsheetFile(name, folderId);
  const { sheets } = await meta(file.id);
  const sheetId = sheets[0].properties.sheetId;
  await batch(file.id, [
    { updateSheetProperties: { properties: { sheetId, title: tab }, fields: "title" } },
    ...setupRequests(sheetId, ownerEmail),
  ]);
  return file.id;
}

// Adds a protected tab to an existing spreadsheet. Picks a free name when the tab exists.
export async function addTab(spreadsheetId: string, wanted: string, ownerEmail: string) {
  const titles = new Set((await meta(spreadsheetId)).sheets.map((s) => s.properties.title));
  let title = wanted.slice(0, 90);
  for (let n = 2; titles.has(title); n++) title = `${wanted.slice(0, 85)} (${n})`;
  const reply = await batch(spreadsheetId, [{ addSheet: { properties: { title } } }]);
  const sheetId = reply.replies[0].addSheet!.properties.sheetId;
  await batch(spreadsheetId, setupRequests(sheetId, ownerEmail));
  return title;
}

// Replaces everything on a tab with these rows. The dashboard's data in Redis is the source of truth.
export async function replaceTab(spreadsheetId: string, tab: string, rows: Cell[][]) {
  await google(`${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(`${a1(tab)}`)}:clear`, { method: "POST", body: {} });
  await google(`${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(`${a1(tab)}!A1`)}`, {
    method: "PUT",
    query: { valueInputOption: "RAW" },
    body: { values: rows },
  });
}

// Reads the first tab of a spreadsheet, for importing past members.
export async function readFirstTab(spreadsheetId: string) {
  const { sheets } = await meta(spreadsheetId);
  const tab = sheets[0].properties.title;
  const data = await google<{ values?: string[][] }>(`${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(a1(tab))}`, { query: { valueRenderOption: "FORMATTED_VALUE" } });
  return data.values || [];
}
