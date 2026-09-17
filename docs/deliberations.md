# CSC deliberations

This feature uses Google Sheets for settings and final ballots.
Initial ratings and revisions stay in each voter's browser until final submission.
No separate database or voter accounts are required.

## Website configuration (already wired for CSC)

The website reuses its existing Google service-account credentials.
The permanent settings spreadsheet is already configured in code.
Future presidents do not need Vercel access to run elections.
Never commit private keys, passwords, or the cookie secret.

| Variable | Value |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Existing service account email |
| `GOOGLE_PRIVATE_KEY` | Existing service account private key |
| `VOTING_SETTINGS_SHEET_ID` | Optional override of the permanent settings spreadsheet |
| `VOTING_COOKIE_SECRET` | Optional random signing secret of at least 32 characters |

Without an override, the app derives a separate signing key from the existing private key.
If needed, generate an override locally with `node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'`.
Keep the same secret across deployed instances.
Changing it signs everyone out.
The existing `GOOGLE_SHEET_ID` remains dedicated to public links.

## Permanent settings spreadsheet

The `Settings` tab can be shared with exec.
Anyone who can edit it can change the session password and election spreadsheet link.
First-join admin assignment assumes a trusted group; it does not verify who is president.
Column A contains the keys below; column B contains their values.
Headers and instructions can appear above the settings.
Column C can contain instructions.

| Key | Meaning |
| --- | --- |
| `session_id` | A unique ID for each election, such as `exec-fall-2026` |
| `session_password` | Shared voter password; blank closes voting |
| `voting_sheet_url` | The current election spreadsheet's Google Sheets URL |

The session password is checked by the server and never returned in the voter state.
There is no separate admin password.
The first person who joins claims admin access.
Admins run the session and cannot submit ballots.
Google Sheets appends an admin claim, and the earliest claim wins even if people join simultaneously.
The hidden, protected `Session History` tab stores these records; do not edit it during voting.
Unhiding it does not grant website admin access.
The sheet owner and service account can edit its protected records.
Changing the voter password affects new arrivals only.
A new session ID or election spreadsheet invalidates old access.
Moving or renaming a spreadsheet does not change its ID.
Copying it creates a new ID.

## Each election

1. Create a blank private spreadsheet and share it as Editor with the service account.
2. Enter its URL, a new session ID, and the shared password in the permanent settings spreadsheet.
3. Open `/vote` and enter your name and the shared password before distributing it to exec.
4. Select **Set up election** to create the required tabs without deleting existing data.
5. Add candidates and criteria, save, and choose a candidate order.
6. Share `/vote` and the voter password with exec.
7. Open initial ratings, lead discussion, then open voting.
   Voters can revise and submit as soon as they are ready.
8. Wait for confirmed submissions, lock the candidate, and move to the next one.
9. Clear `session_password` when voting is finished.

Setup can run again without deleting responses.
The election contains `Candidates`, `Criteria`, `Responses`, `Summary`, plus `Session` and `Ballots` tabs managed by the app.
Leave app-managed IDs and headers intact.
Use the admin page to edit setup before voting begins.
Randomization is saved once, so refreshing does not change the order.

## What voters need to know

Use the same browser throughout the session.
Saving initial ratings keeps them on that device only.
The first saved ratings remain separate from later revisions.
Only **Submit vote** sends both versions to Sheets.
Wait for the saved confirmation before leaving.
Browser storage can be cleared or unavailable, especially in private browsing.
The app reports storage failures and preserves pending submissions until confirmation.
Initial ratings are an honor-system record, because voters control their browsers.

## Operational limits

State updates use polling and a short server cache.
Allow a few seconds for changes to reach everyone.
Each app instance has its own cache; Google API quotas still apply across instances.
Avoid autoscaling many instances for a single small election.
The app retries or reports quota failures instead of claiming a vote was saved.
A unique submission ID lets repeated delivery be treated as one logical ballot.
Sheets cannot provide a transaction spanning phase checks and an append.
Run a short practice election before the meeting and leave final submissions open until expected ballots are confirmed.
Do not let two admins change session controls simultaneously.

## Ownership handoff

Keep the settings sheet and election sheets under club-controlled ownership.
Give incoming presidents access to the settings sheet and election spreadsheet.
Keep website hosting access with the club's technical maintainers.
Keep service-account credentials in the hosting environment, not in the spreadsheet.
Future elections need no code or hosting-setting changes.
The status cell `Settings!A1` follows whether the session password is filled; it does not verify the election setup is complete.

## Returning to a completed candidate

Use **Reopen submissions** to restore the saved ballot version for a completed candidate.
Voters can then submit missing ballots from their original browser drafts.
Already received ballots are not overwritten.

## Admin access

The president joins before sharing the password with exec.
Use the same browser throughout the election.
Signing out and signing back in with the password preserves the browser's admin identity.
Clearing cookies or switching browsers loses that identity; there is no account-based recovery.

The admin sees joined voters who have not submitted for the current candidate.
This list excludes the admin and is not an online-presence indicator.

Initial-rating participation is recorded in the automatically created `Initial submissions` tab.
This stores a receipt per voter and ballot, without storing rating values.
The admin sees everyone still pending during initial ratings; after that stage closes, the final waiting list includes only voters with an initial receipt.
Receipt retries are idempotent, including after the stage closes.

Everyone joins at `/vote` through the same name and password form.
The first admitted participant sees the admin controls on that page; later participants see the voter interface.
The legacy `/vote/admin` URL redirects to `/vote`.
