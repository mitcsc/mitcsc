import type { Candidate, Criterion } from "./types";
import { readRanges, sheets } from "./sheets";


type Sheet = {properties: {sheetId: number; title: string}};

/** Applied on export, so future elections receive the same readable layout automatically. */
export async function polishElectionSheet(id: string, tabs: Sheet[], criterionCount: number) {
  const summary = tabs.find(s => s.properties.title === "Summary")!.properties.sheetId;
  const responses = tabs.find(s => s.properties.title === "Responses")!.properties.sheetId;
  const requests: unknown[] = [
    {updateSheetProperties: {properties: {sheetId: summary, index: 0, hidden: false, gridProperties: {frozenRowCount: 1, hideGridlines: true}}, fields: "index,hidden,gridProperties.frozenRowCount,gridProperties.hideGridlines"}},
    {updateSheetProperties: {properties: {sheetId: responses, index: 1, hidden: false, gridProperties: {frozenRowCount: 1}}, fields: "index,hidden,gridProperties.frozenRowCount"}},
    {updateDimensionProperties: {range: {sheetId: summary, dimension: "COLUMNS", startIndex: 0, endIndex: 22}, properties: {hiddenByUser: false}, fields: "hiddenByUser"}},
    {updateDimensionProperties: {range: {sheetId: summary, dimension: "COLUMNS", startIndex: 0, endIndex: 1}, properties: {pixelSize: 230}, fields: "pixelSize"}},
    {updateDimensionProperties: {range: {sheetId: summary, dimension: "COLUMNS", startIndex: 1, endIndex: criterionCount + 2}, properties: {pixelSize: 160}, fields: "pixelSize"}},
    {updateDimensionProperties: {range: {sheetId: summary, dimension: "ROWS", startIndex: 0, endIndex: 1}, properties: {pixelSize: 38}, fields: "pixelSize"}},
    {repeatCell: {range: {sheetId: summary, startRowIndex: 1, startColumnIndex: 1, endColumnIndex: criterionCount + 1}, cell: {userEnteredFormat: {numberFormat: {type: "NUMBER", pattern: "0.00"}}}, fields: "userEnteredFormat.numberFormat"}},
  ];
  requests.push({repeatCell: {range: {sheetId: summary, startRowIndex: 1, startColumnIndex: criterionCount + 1, endColumnIndex: criterionCount + 2}, cell: {userEnteredFormat: {numberFormat: {type: "NUMBER", pattern: "0"}}}, fields: "userEnteredFormat.numberFormat"}});
  for (const sheetId of [summary, responses]) requests.push({repeatCell: {range: {sheetId, startRowIndex: 0, endRowIndex: 1}, cell: {userEnteredFormat: {backgroundColor: {red: .65, green: .13, blue: .16}, textFormat: {bold: true, foregroundColor: {red: 1, green: 1, blue: 1}}, verticalAlignment: "MIDDLE"}}, fields: "userEnteredFormat"}});
  for (const tab of tabs) {
    if (["Candidates", "Criteria", "Session", "Ballots", "Initial submissions"].includes(tab.properties.title)) requests.push({updateSheetProperties: {properties: {sheetId: tab.properties.sheetId, hidden: true}, fields: "hidden"}});
    if (tab.properties.title === "Sheet1") {
      // Only hide the original blank tab. Never discard or hide unrelated user data.
      const [rows] = await readRanges(id, ["'Sheet1'"], true);
      if (!rows.some(row => row.some(Boolean))) requests.push({updateSheetProperties: {properties: {sheetId: tab.properties.sheetId, hidden: true}, fields: "hidden"}});
    }
  }
  await sheets(id, ":batchUpdate", "POST", {requests});
}

export async function writeSummary(id: string, candidates: Candidate[], criteria: Criterion[], sheetId: number, excludedVoterIds: string[] = []) {
  const quoted = (value: string) => '"' + value.replace(/"/g, '""') + '"';
  const literal = (value: string) => ({userEnteredValue: {stringValue: value}});
  const formula = (value: string) => ({userEnteredValue: {formulaValue: value}});
  const eligible = excludedVoterIds.length ? `,ISNA(MATCH(Responses!$E$2:$E,{${excludedVoterIds.map(quoted).join(",")}},0))` : "";
  const rows = [
    {values: ["Candidate", ...criteria.map(c => c.label), "Votes"].map(literal)},
    ...candidates.map(candidate => ({values: [literal(candidate.name),
      ...criteria.map(c => formula(excludedVoterIds.length ? `=IFERROR(AVERAGE(FILTER(Responses!$K$2:$K,Responses!$C$2:$C=${quoted(candidate.id)},Responses!$H$2:$H=${quoted(c.id)},ISNUMBER(Responses!$K$2:$K)${eligible})),"")` : `=IFERROR(AVERAGEIFS(Responses!$K$2:$K,Responses!$C$2:$C,${quoted(candidate.id)},Responses!$H$2:$H,${quoted(c.id)}),"")`)),
      formula(excludedVoterIds.length ? `=IFERROR(COUNTUNIQUE(FILTER(Responses!$E$2:$E,Responses!$C$2:$C=${quoted(candidate.id)},Responses!$E$2:$E<>""${eligible})),0)` : `=COUNTUNIQUEIFS(Responses!$E$2:$E,Responses!$C$2:$C,${quoted(candidate.id)},Responses!$E$2:$E,"<>")`),
    ]})),
  ];
  // One atomic replacement. Typed strings keep names beginning with '=' literal.
  // Cells omitted within this app-owned range are cleared in the same request.
  await sheets(id, ":batchUpdate", "POST", {requests: [{updateCells: {
    range: {sheetId, startRowIndex: 0, endRowIndex: 102, startColumnIndex: 0, endColumnIndex: 22},
    rows, fields: "userEnteredValue",
  }}]});
}
