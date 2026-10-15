# AGENTS.md - Assisting with the MIT CSC Website

You are helping someone maintain the MIT Chinese Students Club website and its exec dashboard.
The person you are helping may have **little or no coding experience**, so favor doing the edit for them and explaining plainly over handing them raw instructions.
This file tells you how the site is wired and how to make the common changes correctly.

## Stack & deploy model

- Next.js 15 (App Router), TypeScript, Tailwind v4, React 19.
- Hosted on Vercel (Hobby plan). **Pushing to the `main` branch auto-deploys** - there is no separate deploy step.
  Check Vercel for deployment status; a local commit alone does not deploy.
- Vercel Hobby allows 100 deployments a day, and every push to a pull request branch counts too.
  On busy days, group small changes into one push.
  If Vercel says "Deployment rate limited", wait and redeploy later.
- Live at csc.mit.edu. The exec dashboard is at csc.mit.edu/dashboard.
- Upstash Redis is the source of truth for members, events, check-ins, links, home page photo settings, the exec roster, and delib votes.
  It is connected through Vercel's Upstash integration and opened from Vercel (Storage).
  Keep it on the Free plan. Do not upgrade or enable paid usage.
- The club Google account (mitcsc@gmail.com) is connected to the site with OAuth.
  The site uses it to write Google Sheets, read Venmo emails in Gmail, and send Wallet card emails.

## Access: use the club account, no forks

- Do **not** fork the repo. Forks split the history and their PRs are easy to merge out of date.
- Maintainers use the shared club account, **mitcsc@gmail.com**. The login is in the **README Google Sheet** in the club Google Drive.
  Do not copy the password into code, commits, or chat logs.
- Sign-in order:
  1. Log in to the mitcsc@gmail.com Gmail account first.
  2. Then log in to GitHub (and Vercel) with that Gmail. GitHub sends its two-step verification code to that inbox, so having Gmail open lets them finish signing in.
- If Gmail itself asks for extra verification (phone code, recovery prompt, etc.), the user should contact the current club presidents.
  Do not try to work around it.
- Make edits in the club's own repo: commit directly to `main` or open a branch in that repo.
  If the user is on a personal account or a fork, stop and tell them to sign in to the club account first.
- Dashboard sign-in is separate: exec use their own Google account. Section 7 covers who has access.

## Golden rules

1. **Check whether the dashboard already does it.** Members, payments, events, check-in, the signup form, links, short links, home page photos, the exec and alumni pages, and delibs are all managed at csc.mit.edu/dashboard.
   Send the user there first.
2. **Prefer the config/data files over touching real code.** The remaining routine code edits (footer links, the older alumni name lists) are data edits in `src/config/`.
   Only go into `src/app`, `src/components`, or `src/lib` when the task genuinely requires it, and flag to the user that it's a code change.
3. **Never invent credentials, sheet IDs, or URLs.** If you need one and don't have it, see "Where things live" below or ask the user.
4. **Keep the existing format exactly** when editing arrays - match the field names, quoting, and trailing commas already in the file.
5. For code changes, explain that pushing to `main` triggers deployment and that they can verify it in Vercel.
   Dashboard changes do not need a deployment.
6. **Protect live data.** Redis holds real member, payment, and vote records.
   Never clear Redis, delete records, or reset a live delib as a troubleshooting shortcut.
   `npm run dev` is local mode: a private database on this computer, with Google, Wallet cards, and emails off.
   `npm run dev:live` uses the values from `vercel env pull`. It reads and writes the live database and acts as the club Google account.
   It can change Drive files and Sheets, and it can send real emails to members.
   `npm run dev:live` asks for `y` before it starts. Never start it or answer `y` without the user's yes, and say why local mode is not enough.
   In live mode, before any action that writes data or sends email, tell the user it affects the real site and wait for a yes.
   Avoid deployment or credential changes during an election.
7. **Preserve exec order.** The order on the Exec and Alumni pages is the order in Dashboard > Website, and it follows the role hierarchy in the Roles tab (section 3).
   Change the order by dragging in the dashboard. Never re-sort (alphabetically, by year, etc.).
8. **Fix bugs without touching live data.** First reproduce the bug in local mode (`npm run dev`, a private database on this computer) or with the tests (`npm run test:membership`, `npm run test:links`, `npm run test:exec`, `npm run test:voting`).
   Neither touches live data.
   Use live mode (`npm run dev:live`) only when the bug depends on real records that the tests cannot copy, for example one member's payment status looks wrong.
   In that case, ask the user first. Say which records you will read or change, and why.
   Read before you change anything. Change only the records the bug involves, and tell the user exactly what you changed.
   Never delete records, clear Redis, or run a script that changes many records at once.
   To test a fix, do not send emails, make Wallet cards, or edit Drive files. These reach real members or use up the monthly Wallet limit.

## Where things live (answer these if the user asks)

- **GitHub / Vercel login**: the shared club account (mitcsc@gmail.com). Credentials are in the **README Google Sheet** in the club Google Drive.
  Sign in to Gmail first, then GitHub. For any verification issues with the account, contact the presidents. See "Access" above.
- **Credentials / env vars**: they live in Vercel (Settings > Environment Variables). Most work needs none: `npm run dev` (local mode) runs without them.
  Only `npm run dev:live` needs the real values. Pull them into `.env.local` (gitignored) while signed in to Vercel as the club account:

  ```bash
  npx vercel login                 # Continue with GitHub, as the club account
  npx vercel link                  # once: pick the mitcsc project
  npx vercel env pull .env.local   # the Development values
  ```

  Do not guess, print, or copy secret values into code, commits, chat, or troubleshooting reports.
- **Dashboard instructions**: the **Dashboard** tab of the maintenance guide (a Google Doc in the club Drive). Point non-technical users there for anything the dashboard does.
- **Links and short links** are edited in Dashboard > Website > Links, not in code.
- **The exec and alumni pages** are edited in Dashboard > Website (Exec, Alumni, Roles), not in code.

---

## 1. Deploying

Push to `main` → Vercel auto-deploys. Nothing else.
If the user is editing through the GitHub website (signed in as the club account), committing to `main` *is* the push.
Dashboard changes (links, photos, exec, members, form, events) are live right away and need no deploy.

## 2. Home page photos

- The home page shows photos from the Drive folder **MIT CSC > Website > Front Page Photos**.
- To add photos: upload them to that folder in Drive, then turn them on in Dashboard > Website > Home. New photos start off.
- **No code edit needed.** The home page picks 16 active photos at random on each load.
- The file name is shown as the caption under each photo, so rename files in Drive before turning them on.
- `public/img/event/` is only the fallback set, shown when no Drive photos are active.
  Files there need a code push; the list is generated by `scripts/generate-event-images.mjs` at build time.

## 3. Exec and alumni

The Exec and Alumni pages come from the dashboard, not code. Send the user to Dashboard > Website (Exec, Alumni, Roles).

- The roster is one JSON record in Redis (`csc:membership:v1:exec-roster`).
  Code: `src/lib/exec.ts`, `src/lib/exec-roster.ts`, `src/components/dashboard/ExecRosterView.tsx`, `src/components/dashboard/RolesView.tsx`.
- **Order:** the list order is the page order. It follows the role hierarchy, which is the order of the Roles tab.
  People with the same role stay together. A new person goes directly after the last person with their role, not at the end.
  When someone changes role, move them to the new role group too.
  After a change, list the final order (name + role) back to the user.
- **Roles** are the positions active exec can have. Alumni positions are free text and keep the title the person held.
- **Photos** live in the Drive folder MIT CSC > Website > Exec Photos, in its Active and Alumni folders.
  A photo moves with its person (best effort; the site finds photos by Drive file id, so a failed move breaks nothing).
  Exec pick or upload one when they edit a person. The site serves them through `/api/exec-photos/`.
- **Move to alumni** puts people at the top of Alumni in their active order.
  **Move to active** and **+** put a person right after the last person with their role (a position that is no longer a role goes last).
  Undo puts a person back where they were.
- The public pages update within seconds of a change (cache tag `exec`), and at least hourly.
- The older alumni name lists by year are in `src/config/past-alumni.ts` (`{ year, names: [...] }`).
  Low priority; do not push the user to fill them out.
- Do not edit the roster in Redis by hand. If the dashboard cannot do something, change the dashboard code.
  Try roster changes in `npm run dev` (local mode) first.

## 4. Changing links

### A. Static site / footer links - `src/config/links.ts`

Edit this file directly for the fixed links on the site and footer:

- `membership` - where the home page "Join" button goes
- `calendarLink` - the CSC Google Calendar (also the default calendar link on the signup form)
- `email` - contact email
- `instagramLink`
- `nav` - the About / Exec / Alumni / Links / Contact menu items

Commit to `main` → Vercel rebuilds automatically.

### B. The `/links` page and short-URLs - the dashboard, NOT code

If the user wants to change anything on the `/links` page, or a `csc.mit.edu/<name>` redirect, **this is done in Dashboard > Website > Links, not in the repo.**
Each link has:

- **Title** - what shows on the `/links` page
- **Goes to** - the destination URL
- **Short link** (optional) - the redirect name (e.g. `membership` → csc.mit.edu/membership)
- **Expires** (optional) - the link works through the end of that day (Boston time), then both the listing and the short link stop working.
  Use for event RSVPs, care-package signups, anything to auto-clean after a date.
- **Show on the Links page** - off keeps the short link working but hides it from `/links`.
- Drag rows to set the order on `/links`. Changes are live immediately.

Short links use lowercase letters, numbers, and hyphens.
Names that are site pages (join, links, dashboard, exec, alumni, vote, api, ...) are reserved; see `RESERVED_SLUGS` in `src/lib/link-rules.ts`.
Do not attempt to edit shortlinks through the code - there is nothing to edit there.

## 5. The exec dashboard (csc.mit.edu/dashboard)

For how to use it, point the user to the **Dashboard** tab of the maintenance guide.
Only dig into the code if something is broken or they want a change.

- **Sign-in**: Google sign-in. Access = Owner/Editor on the club Drive's "MIT CSC" folder (individual emails only), cached 5 minutes.
  The club account can always sign in.
  A sign-in lasts 30 days from the last visit (`src/lib/membership/session.ts`, renewed by `src/middleware.ts`).
  Local mode (`npm run dev`) signs in as `exec@mit.edu` without Google.
- **Sections**: Check-In (Check-In, Events), Membership (Members, Edit Form, Settings), Delibs (Live, History), Website (Links, Home, Exec, Alumni, Roles), Settings.
  Each tab's URL ends with its name, like `/dashboard/website/home` or `/dashboard/membership/edit-form`.
  The tabs are listed in `src/components/dashboard/nav.ts`.
- **Membership**: `/join` is the public signup and payment page (Venmo, Zelle, cash).
  Venmo payments confirm themselves when the note matches exactly (`CSC-<year>-<kerb>`).
  Each school year has its own Drive folder and members sheet.
  The sheet is a protected mirror that is fully rewritten from Redis, so edits made in it are lost.
- **Wallet cards**: members request a one-time email link at `/join/pass`. Cards come from WalletWallet (`WALLETWALLET_API_KEY`).
  Exec scan the card's QR code at Check-In.
  WalletWallet's free plan makes 1,000 passes a month (creating or cancelling a card counts) and answers 429 past it.
  The site then saves the reset day (`wallet-paused` key), hides every Wallet option from members until then, and shows exec a banner.
  Settings shows this month's count.
- **Events**: each event gets its own Google Sheet with an "Attendance" tab. Check-in opens and closes on its own at the event hours.
- **Club Google connection**: Dashboard > Settings > Club Google account.
  If it breaks (e.g. after a password change), a banner appears, and Venmo checks, sheet updates, and card emails stop.
  They start again when someone presses **Reconnect** and signs in as mitcsc@gmail.com with every permission.
- Code: `src/app/dashboard/`, `src/components/dashboard/`, `src/lib/membership/`, `src/lib/links.ts`, `src/lib/home-photos.ts`, `src/lib/exec.ts`, `src/app/join/`.

## 6. Yearly maintenance checklist

- Start the new school year in Dashboard > Membership > Settings (available from June 1), then turn on **Accepting signups** when ready
- Check where the home page "Join" button goes (`membership` in `src/config/links.ts`)
- Move graduating exec to alumni in Dashboard > Website > Exec
- Add the new exec in Dashboard > Website > Exec, in role order (section 3)
- Refresh home page photos in the Drive folder and Dashboard > Website > Home
- Delete expired/dead links in Dashboard > Website > Links
- Officer handoff (section 7)
- Before an election, run a practice delib with a few exec

## 7. Officer handoff

- The next maintainer needs the club account login (README Google Sheet).
  That one account signs in to Gmail, GitHub, Vercel, and the club Google Drive.
- Upstash opens from Vercel (Storage), so it needs no separate login.
- Dashboard access: share the "MIT CSC" Drive folder with each new exec as Editor (by email), and unshare graduated exec.
  Changes apply within 5 minutes, or press **Check again** in Dashboard > Settings.
- If the club account password changes, reconnect it in Dashboard > Settings (Club Google account).

## 8. Voting platform (delibs)

Delibs: https://csc.mit.edu/dashboard/delibs/live

Normal use happens in the dashboard, not through code.
For operating instructions, point the user to the **Voting Platform** tab (under the Dashboard tab) in the maintenance guide.
Only dig into the implementation if something is broken or they want a change.

### How it is wired

- Any exec signed in to the dashboard can start a delib and becomes the host. Only one delib can run at a time.
- Other exec join automatically under their Google name. The host does not vote. The club account can host but cannot vote.
- Redis is the source of truth for delibs, admission, initial ratings, and final votes. It is required.
- After a delib ends, its host can view results, **Download CSV**, or **Save to Drive** (the host's own Drive) from the History tab.
- Records stay in Redis until the host deletes the delib. Deleting cannot be undone.

### Behavior to preserve when changing code

- Only the host can see results, end the delib, or rename/delete it after it ends.
- Joins before voting starts are admitted automatically.
  Late arrivals require approval and see no candidate or voting information while waiting.
  Waiting voters do not block rounds.
- Kick permits normal rejoining and keeps submitted votes counted.
  Ban blocks that identity for this delib and excludes its votes from results, while retaining audit records.
- A new delib requires a fresh join. Old bans and admission must not carry over.
- Ending returns everyone to the idle Live tab, including after refresh.
  It does not delete records, and an ended delib cannot be resumed.
- Initial ratings and final votes are different submissions. Advancing must never silently submit someone's draft.
  Keep retries safe and accepted initial ratings authoritative.
- Presence is approximate browser activity, not proof of attention or a reason to automatically remove someone.
  Keep it separate from admission and vote counting.

### Configuration

Production values live in Vercel environment variables. Redeploy after changing them.
For local values, see "Credentials / env vars" above.

- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` - Redis connection.
  The `KV_REST_API_URL` + `KV_REST_API_TOKEN` names (set by Vercel's Upstash integration) also work.
  Use a writable token and keep eviction disabled so ballots are not discarded.
- `MEMBERSHIP_SECRET` - at least 32 random characters.
  Signs member cookies, dashboard sessions, Wallet card QR codes, card email links, and delib export links.
  Changing it signs everyone out and breaks existing Wallet card QR codes.
- `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` - Google sign-in and the club account connection.
  Redirect URI: `https://csc.mit.edu/api/auth/google/callback`.
- `CLUB_GOOGLE_EMAIL` - the club account (defaults to mitcsc@gmail.com).
- `CRON_SECRET` - random secret of at least 32 characters. Vercel sends it to both cron jobs.
- `WALLETWALLET_API_KEY` (+ optional `WALLETWALLET_PLAN=pro`) - Wallet cards. Without it, Wallet buttons are off.

### Keeping it hands-off and free

`vercel.json` schedules two cron jobs:

- `/api/cron/redis-health` on Monday and Thursday at 07:00 UTC.
  It writes one health timestamp so Upstash does not mark the database inactive. It does not touch votes or members.
- `/api/cron/membership` daily at 13:00 UTC.
  It checks Venmo emails, rewrites the members sheet, and re-lists the Front Page Photos folder.
  It skips when the club Google account is not connected.

Both only run after production deployment with working credentials.
Check Vercel cron logs after configuration changes; do not assume a schedule means successful execution.

Keep Upstash on **Free**. Do not add paid services or upgrade to resolve a usage warning.
Check the dashboard and investigate unnecessary polling instead.
Provider allowances can change, so verify current limits before advising the user.
Most delib commands come from state polling: one `MGET` per poll, every three seconds while the tab is visible.
Avoid duplicate requests, per-voter host reads, or cached authorization that would delay kicks/bans or allow old delibs through.

### Files and checks

- UI: `src/components/voting/` and `src/app/dashboard/delibs/`
- API routes: `src/app/api/voting/`
- Delib rules and persistence: `src/lib/voting/redis-service.ts`
- Presence: `src/lib/voting/presence.ts`
- CSV export: `src/lib/voting/export.ts`, `src/lib/voting/export-link.ts`
- Technical notes: `docs/deliberations.md` (check current code if the notes and code disagree)

For code changes, run `npx tsc --noEmit`, `npm run lint`, and the relevant tests: `npm run test:voting`, `npm run test:voting:redis`, `npm run test:membership`, `npm run test:links`, `npm run test:exec`.
Redis tests need `redis-server` and `redis-cli`; they use an isolated local database.
Browser tests under `tests/voting-*.e2e.cjs` run against a local mode server (`PORT=3020 npm run dev`) with `VOTING_TEST_URL` set (see `docs/deliberations.md`).
Passing tests is not proof that production credentials, Google access, or cron jobs work.
Never point automated tests at the live database or use real member data as fixtures.

---

## Keep this file current

This file is the maintainers' technical guide. Update it in the same change as the code it describes.
The maintenance guide (Google Doc) covers only how exec use the site and the dashboard.

## How to interact with the (possibly non-technical) user

- First check whether the dashboard already does what they want. If so, walk them through it instead of editing code.
- For code changes, confirm they are signed in to the club account (mitcsc@gmail.com), not a personal account or fork.
- When they describe a goal in plain terms ("add the new treasurer", "swap the join link"), map it to the right file/folder above and make the smallest correct change.
- Show them the exact before/after of any code-file edit. For exec order changes, also show the final order.
- Explain deployment only when it applies. Code changes need a push to `main`; dashboard changes do not.
  A local code change is not live until it is pushed.
  `npm run dev` uses a private database, so nothing done there reaches the real site.
  In `npm run dev:live`, a dashboard action (adding a member, editing a link) is live right away, because it uses the live database.
- If a request needs touching real code (`src/app`, `src/components`, `src/lib`), say so explicitly and proceed carefully - these can break the build in ways the data files can't.
