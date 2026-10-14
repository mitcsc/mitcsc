# CSC delibs

Delibs is the voting tab of the exec dashboard, at `/dashboard/delibs`.
Execs sign in with Google, the same as for the rest of the dashboard.
There is no voting password.
The old `/vote` and `/deliberations` links redirect to the tab.

## How a delib runs

1. An exec opens the Delibs tab and selects **Start a delib**.
2. They enter a name, the criteria, and the candidates.
3. That exec is the host. The host runs the rounds and does not vote.
4. Every other exec who opens the tab joins automatically under their Google name.
5. For each candidate, the host opens initial ratings, then discussion, then final voting, and then closes the round.
6. After the last round, the host selects **End voting** and sees the full results.

Only one delib can be open at a time.
Only the host sees the results, and only for delibs they hosted.
The host can open past results from **Your past delibs** on the Delibs tab.

Execs must sign in again after this change so that the dashboard session has their Google name.

## Results and export

Votes stay in Redis. Nothing is written to Google Sheets or Drive while voting runs.
On the results page, the host can:

- Select **Download CSV** to download one row per ballot.
- Select Google's **Save to Drive** button to save the same CSV to their own My Drive.

Google's button fetches the CSV without the dashboard cookie.
So the results page gives the button a link with a signed token that names the delib and its host.
The token expires after one hour, and `MEMBERSHIP_SECRET` signs it.
Google saves the file as a CSV file, not as a Google Sheet.

## Deployment

Connect an Upstash Redis database to the Vercel project.
Use the Free plan unless CSC explicitly approves a paid plan.
The integration supplies `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
The app also accepts `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
Use the writable REST token, not the read-only token.
Keep eviction disabled: ballots must not be removed to make room for other keys.

Delibs uses the dashboard's Google sign-in and `MEMBERSHIP_SECRET`.
It no longer uses `VOTING_PRESIDENT_PASSWORD`, `VOTING_COOKIE_SECRET`, `VOTING_SETTINGS_SHEET_ID`, or the Google service account.
You can delete those voting variables from Vercel.
The service account is still used for the public links sheet.

Redis is required.
Missing Redis data fails closed and must be restored from a backup.

## Storage

Voters and the host poll every three seconds.
A hidden voter tab polls about every 20 seconds, so the host still sees the voter as away.
A hidden host tab stops polling.

Submitting a ballot saves it in Redis before the voter receives confirmation.
An atomic compare-and-set checks the phase and stores the ballot together.
A round that closes at the same time cannot discard a submission that was already confirmed.
Retries return the existing receipt instead of creating another ballot.
Accepted initial ratings are authoritative; final submission cannot replace them.
A voter can recover their own accepted ratings after losing browser drafts, but cannot read another voter's ratings.
Late arrivals take part starting with the next candidate, unless the host admits them earlier.
Reopening a closed candidate keeps its votes and its original ballot version.

## Verification and limits

`npm run test:voting` runs the security, CSV export, and health check tests.
`npm run test:voting:redis` needs `redis-server` and `redis-cli` on PATH.
It starts a separate local Redis server and checks concurrent joins and submissions, phase races, retries, kick and ban, presence, and results.

The browser tests in `tests/voting-*.e2e.cjs` mock the voting API, so they never touch Redis.
Run them against a local dev server started with `DASHBOARD_DEV_EMAIL` set, for example:

```bash
DASHBOARD_DEV_EMAIL=exec@mit.edu npx next dev -p 3020
```

```bash
VOTING_TEST_URL=http://localhost:3020 node tests/voting-admin.e2e.cjs
```

The app supports up to 128 voters, 100 candidates, and 20 criteria.
These input limits do not promise that every combination fits a provider's free allowance.

A Redis health check is scheduled for Monday and Thursday at 07:00 UTC in `vercel.json`.
Vercel Hobby may invoke it at any time within that hour; the handler adds a random 0-5 second delay.
Set a randomly generated `CRON_SECRET` of at least 32 characters in Vercel's Production environment.
Vercel sends that secret as the Authorization bearer token; a missing or wrong secret fails before any Redis access.
Each successful run updates only a health check timestamp.
Check the Vercel cron logs after deployment; failed runs return HTTP 503 and Vercel does not retry them.
See [Vercel scheduling limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) and [Upstash inactivity policy](https://upstash.com/docs/redis/help/faq#what-happens-if-my-database-is-not-used).
Before a delib, confirm that the Redis database is available and run a short practice round.
