# CSC voting

The voting app uses Redis for live session state, registrations, initial submission receipts, and final ballots.
Google Sheets holds the session settings and receives results when the admin closes each candidate.
Saving initial ratings stores them in Redis. Unsubmitted revisions remain in the browser; final submission stores them in Redis too.

## Deployment

Connect an Upstash Redis database to the Vercel project.
Use the Free plan unless CSC explicitly approves a paid plan.
The integration supplies `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
The app also accepts `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
Use the writable REST token, not the read-only token.
Keep eviction disabled: ballots must not be removed to make room for other keys.

The existing `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` still authorize Sheets exports.
`VOTING_SETTINGS_SHEET_ID` optionally overrides the permanent settings spreadsheet.
`VOTING_COOKIE_SECRET` optionally overrides the signing secret derived from the Google private key.
All instances must use the same signing secret.
Never commit credentials or include them in logs.
The existing `GOOGLE_SHEET_ID` remains dedicated to public links.

When Redis credentials are configured, Redis errors never fall back to Sheets.
The old Sheets implementation remains available for the isolated demo and elections that have not switched.
A `storage_backend=redis` marker prevents the new code from reopening an exported election through the Sheets implementation.
An election already started under the old implementation cannot be imported automatically.
Finish that election there, or start a new election spreadsheet and session ID.
An unstarted election imports its candidates, criteria, and existing Session History identities once.

## Running an election

1. Create a blank private spreadsheet and share it as Editor with the Google service account.
2. In the permanent settings sheet, enter its URL in `voting_sheet_url`, a unique `session_id`, and a shared `session_password`.
3. The president joins `/vote` first to become admin, before sharing the password with exec.
4. Set up the election and add candidates and criteria in the admin page.
5. Wait for everyone to join, then start the first candidate.
6. Collect initial ratings, lead discussion, and open submissions.
7. Close the candidate after the expected voters submit.
8. Clear `session_password` when finished.

First-join ownership assumes a trusted group; it does not verify who is president.
Admins cannot vote.
Redis assigns the first admin atomically, even when joins arrive together.
Existing Session History records are imported for an unstarted election, but new registrations live in Redis.
Unhiding Session History does not grant admin access.
Moving or renaming a spreadsheet does not change its ID; copying it does.
Use a new session ID and a new spreadsheet for each election.
Future presidents do not need Vercel access for routine elections.

## Storage and exports

With Redis, voters and admins poll every three seconds. Hidden tabs stop polling.
The legacy Sheets-only mode retains its four/eight-second intervals.
They read a shared Redis status document containing no rating values.
Settings are refreshed directly from Sheets into a shared Redis cache every 30 seconds,
with up to five seconds of additional per-process caching. There is no second Sheets cache delay.
Allow roughly 35 seconds plus request latency for settings edits to propagate.
Admin phase changes do not wait for that cache.

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

`npm run test:voting` runs the legacy Sheets and security tests.
`npm run test:voting:redis` requires `redis-server` and `redis-cli` on PATH.
It starts an isolated local Redis server and simulates Sheets, with no external requests.
It checks concurrent joins and submissions, phase races, retry recovery, export failure, and missing-database behavior.
The test confirms zero Sheets calls during voting actions and status polling, excluding periodic settings refreshes.

The separate local rehearsal script uses real Upstash and the explicitly designated test spreadsheet.
It refuses a different spreadsheet, session ID, or already-started election.
Its report excludes passwords, cookies, voter names, and ratings.
A successful local rehearsal does not verify Vercel environment configuration; check the deployed join and submission flow separately.

The app supports up to 128 voters, 100 candidates, and 20 criteria, with an 8 MB live-document ceiling.
These input limits are not a promise that every combination fits a provider’s free allowance.
Provider command, bandwidth, storage, and inactivity policies still apply.
No inactivity cron is configured yet.
Before an election, confirm the Redis database is available and run a short practice ballot.
If Redis data is missing, restore the database instead of clearing the Sheets marker or starting over in the same election.
