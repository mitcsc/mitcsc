import type { ElectionResults } from "./results";

// One row per submitted vote: the final ratings first, then the ratings from before the discussion.
export function resultRows(results: ElectionResults): string[][] {
  const rating = (value: number | null | undefined) => value == null ? "" : String(value);
  return [
    ["Candidate", "Voter", ...results.criteria.map(c => c.label), ...results.criteria.map(c => `${c.label} (initial)`), "Submitted"],
    ...results.candidates.flatMap(({candidate, ballots}) => ballots.map(b => [
      candidate.name, b.voterName,
      ...results.criteria.map(c => rating(b.final[c.id])),
      ...results.criteria.map(c => rating(b.initial[c.id])),
      // The server runs in UTC, so name the club's time zone.
      new Date(b.submittedAt).toLocaleString("en-US", {timeZone: "America/New_York"}),
    ])),
  ];
}

export function toCsv(rows: string[][]) {
  // A leading =, +, - or @ would run as a formula when the file opens in a spreadsheet.
  const cell = (value: string) => {
    const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map(row => row.map(cell).join(",")).join("\r\n");
}


export function exportFileName(name: string) {
  return `${name.replace(/[^\w .-]+/g, "").trim() || "Delibs"}.csv`;
}
