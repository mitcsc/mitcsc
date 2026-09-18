# Voting audit, September 2026

## Changes

Redis is the authority for a running election. Sheets remains the durable report and per-candidate archive. No live database or spreadsheet was modified during this audit.

- Redis sessions poll every two seconds for both voters and admins, instead of four/eight seconds. Hidden tabs pause polling; failed requests back off. Legacy Sheets-only sessions keep their slower intervals.
- Settings refresh through a shared 30-second Redis cache and a five-second process cache. Refresh reads Settings only and bypasses the old additional two-minute Sheets cache. Concurrent refreshers recheck the shared cache after acquiring the lock.
- Accepted initial ratings are stored in Redis, returned only to their authenticated voter through a recovery endpoint, and used as the original ratings at final submission. Browser recovery preserves unsent revisions. Initial receipts without a final vote also archive their ratings in Sheets when the candidate closes.
- New elections reserve only the rows actually needed by accepted ballots. Allocation and round closure happen in one Redis transaction. Retrying an export writes identical addresses, while reopening allocates new addresses only for additional ballots. This avoids both blank blocks and append-on-retry duplicates.
- Summary still has one row per candidate, columns for final criterion averages, and a vote count. Names and formulas now update together in a single request. Names are typed as literal strings, including names beginning with `=`.
- Late arrivals are eligible for the next candidate, rather than being excluded for the rest of the election. Final submission requires an accepted initial receipt.
- Admin phase changes carry the displayed live candidate, version and phase. A stale tab receives a conflict instead of operating on a different round. Requests have timeouts, and Redis contention retries have a bounded retry window.
- Unauthenticated state requests reject before fetching settings. A blocked sessionStorage no longer prevents joining. Ballot retry delays start at one second while respecting server retry instructions.
- Redis saves the authoritative document and status projection with one MSET inside the compare-and-set script. The projection excludes rating values and archive row allocations.

## Compatibility and data safety

Existing Redis elections retain their original fixed row addresses. Automatically moving those rows while old exports or old deployments may still be running would be unsafe. Compact exports apply to new elections. Cleaning existing gaps is a separate, offline migration after voting and pending exports finish; it was not performed here.

Old initial receipts may not contain recoverable ratings until a final ballot has been stored. The new recovery behavior cannot reconstruct data that the previous implementation never sent to the server.

Responses is an audit log in export order. Reopened late ballots can appear at the bottom. Summary remains in setup order and matches candidate/criterion IDs, not row positions or discussion order.

## Verification

The Redis suite uses a real temporary local Redis server and mocked Sheets. It covers 30 concurrent voters, atomic first-admin admission, lost acknowledgements, simultaneous close/submission, export failure and retry, missing Redis, compact out-of-order exports, reopening, private rating recovery, immutable original ratings, late arrivals, stale admin actions, and legacy address preservation.

Browser tests mock every voting API request and exercise joining, local draft persistence, rating selection, retries, recovery after clearing storage, confirmed submission, admin routing and controls. The existing Sheets/security suite remains part of validation.

These checks do not claim to reproduce Upstash outages, Google formula recalculation, or the current Vercel deployment. A short deployment smoke check is still appropriate after installing this version.

## Remaining tradeoffs

Polling is still used. A normal update appears within approximately two seconds plus network/server latency, not instantaneously. Faster polling consumes Redis commands and bandwidth; adding another realtime provider is unnecessary for this small, occasional session.

The full private election document is read and compared for mutations. This is practical for the tested 30-voter workload, but grows with election size and should not be extrapolated to the maximum input limits without testing. All accepted ballots require Redis availability; provider limits, backups and inactivity policy remain operational concerns.

Unsent edits remain local. Accepted ballots survive browser refresh while the signed-in identity remains available. This is not account-based cross-device login. First-join admin ownership still assumes the president joins first in a trusted group.

Sheets is updated on candidate closure, not on each vote. An export failure retains the ballots in Redis and blocks advancement until the admin retries successfully. Formatting still occurs during export and a formatting failure can require retry; retries are safe.

## API reference

The atomic Summary update follows Google's [UpdateCellsRequest range semantics](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request#UpdateCellsRequest): omitted values within the specified range are cleared as part of the same request.
