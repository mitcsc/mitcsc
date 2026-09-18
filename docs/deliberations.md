# CSC voting

The voting app uses Redis for live session state, registrations, initial submission receipts, and final ballots.
Redis holds session settings and Google Sheets receives results when the admin closes each candidate.
Saving initial ratings stores them in Redis. Unsubmitted revisions remain in the browser; final submission stores them in Redis too.

## Deployment

Connect an Upstash Redis database to the Vercel project.
Use the Free plan unless CSC explicitly approves a paid plan.
The integration supplies `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
The app also accepts `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
Use the writable REST token, not the read-only token.
Keep eviction disabled: ballots must not be removed to make room for other keys.

The existing `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` still authorize Sheets exports.
`VOTING_COOKIE_SECRET` optionally overrides the signing secret derived from the Google private key.
All instances must use the same signing secret.
Never commit credentials or include them in logs.
The existing `GOOGLE_SHEET_ID` remains dedicated to public links.

Redis is required; errors never fall back to Sheets.
Missing Redis election data fails closed and must be restored, not reconstructed from an older export.
The exec settings sheet and first-join admin workflow are no longer used.

## President-managed elections

Set `VOTING_PRESIDENT_PASSWORD` in Vercel to a random password of at least 8 characters.
Keep it in CSC's password manager or officer handoff records, not in a spreadsheet or source control.
Redis and the president password are required.
Existing election data is not imported or replaced.
Deploy this workflow only after the existing election has finished exporting.
Changing the environment password and redeploying invalidates president logins.
No in-app password change is provided; Vercel remains the source of this credential.

1. The president opens `/vote/admin` and enters the president password.
2. They enter an election name, voter password and new results spreadsheet link.
3. The spreadsheet must already be shared as Editor with the Google service account.
4. The app verifies edit access by creating its Session marker before admitting voters.
5. The president adds candidates and criteria, while voters join `/vote` with their name and voter password.
6. Closing each candidate exports results to Sheets.
7. After the last export, **End session** closes access and allows creation of the next election.

Election IDs are generated automatically.
Voters never become admin by joining first in this mode.
Ending a session is blocked during an active round or pending export.
An ended election cannot be restarted; its Redis data and Sheets results remain preserved.
Use a new spreadsheet for each election.
An already-used app-managed spreadsheet is rejected.
A shared CSC Elections folder can simplify granting the service account access to new spreadsheets.
Moving or renaming a spreadsheet does not change its ID; copying it does.

## Storage and exports

With Redis, voters and admins poll every three seconds. Hidden tabs stop polling.
Session settings live in Redis and require no periodic Sheets reads.

Submitting a ballot saves it in Redis before the voter receives confirmation.
An atomic compare-and-set validates the phase and stores the ballot together.
A simultaneous close cannot discard a submission that has already been acknowledged.
Retries return the existing receipt instead of creating another ballot.
The live documents have no expiry.
Accepted initial ratings are authoritative; final submission cannot replace the original ratings.
A signed-in voter can recover their own accepted ratings after losing browser drafts, but cannot retrieve another voter’s ratings.
Late arrivals become eligible starting with the next candidate.

Closing a candidate freezes submissions and exports their votes and initial receipts in one Sheets values batch.
Tab creation, row allocation, and the summary formula can require additional setup calls.
The app marks the candidate complete only after Sheets acknowledges the export.
If export fails, the admin sees **Retry export to Sheets**.
The votes remain in Redis, and another candidate cannot start until export succeeds.
Reopening preserves existing votes and the original ballot version.
New elections allocate contiguous row addresses in Redis for actual ballots when a candidate closes.
Retries reuse those addresses; late submissions after reopening receive the next unused rows.
There are no reserved 128-voter gaps. Responses follows export order; Summary follows setup order.
Candidate and criterion IDs keep ratings correctly associated regardless of voting order.
Existing elections without compact allocation metadata retain their old addresses. Never compact a running election.
Summary names and formulas update together in one request, rather than clearing the report first.

The app manages Candidates, Criteria, Responses, Summary, Session, Ballots, and Initial submissions tabs.
Summary and Responses remain visible; app-managed tabs are hidden automatically on export.
The original Sheet1 is hidden only if it is empty.
Summary shows one candidate per row, one final-average column per criterion, and a vote count.
Averages display to two decimal places; submitted initial/final ratings remain in Responses.
Initial submissions also archives accepted initial ratings and voter names, including voters who never submitted a final ballot.
Keep app-managed headers and IDs intact.
The Summary formula computes averages from exported final ballots.
Setup changes are saved in Redis; Sheets receives the frozen definitions with the first candidate export.

## Verification and limits

`npm run test:voting` runs security, president-login and health-check tests.
`npm run test:voting:redis` requires `redis-server` and `redis-cli` on PATH.
It starts an isolated local Redis server and simulates Sheets, with no external requests.
It checks concurrent joins and submissions, phase races, retry recovery, export failure, and missing-database behavior.
The test confirms zero Sheets calls during voting actions and status polling, excluding periodic settings refreshes.

The obsolete Sheets-driven demo and live rehearsal scripts have been removed.
Browser tests use mocked voting APIs; they never contact real Sheets or Redis.

The app supports up to 128 voters, 100 candidates, and 20 criteria, with an 8 MB live-document ceiling.
These input limits are not a promise that every combination fits a provider’s free allowance.
Provider command, bandwidth, storage, and inactivity policies still apply.
A Redis health check is scheduled for Monday and Thursday at 07:00 UTC in `vercel.json`.
Vercel Hobby may invoke it within that hour; the handler adds a random 0–5-second delay.
Set a randomly generated `CRON_SECRET` of at least 32 characters in Vercel's Production environment before deploying.
Vercel passes that secret as the Authorization bearer token; missing or incorrect credentials fail before any Redis access.
Each successful invocation updates only a dedicated health-check timestamp, with no election or Sheets access.
This adds roughly nine Redis commands per month.
Cron runs only after production deployment; adding the files alone does not activate it.
Check Vercel cron logs after deployment; failed runs return HTTP 503 and Vercel does not automatically retry them.
Periodic requests should avoid inactivity under Upstash's published definition, but synthetic keep-alives are not expressly guaranteed.
See [Vercel scheduling limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) and [Upstash inactivity policy](https://upstash.com/docs/redis/help/faq#what-happens-if-my-database-is-not-used).
Before an election, confirm the Redis database is available and run a short practice ballot.
If Redis data is missing, restore the database instead of clearing the Sheets marker or starting over in the same election.
