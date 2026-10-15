# MIT CSC website

The website of the MIT Chinese Students Club, live at [csc.mit.edu](https://csc.mit.edu).
Exec manage members, events, links, home page photos, the exec and alumni pages, and delibs in the dashboard at [csc.mit.edu/dashboard](https://csc.mit.edu/dashboard).

The club's maintenance guide (a Google Doc in the club Drive) covers day-to-day changes and the dashboard.

## Stack

- Next.js 15 (App Router), React 19, TypeScript, and Tailwind v4.
- Hosted on Vercel. Every push to `main` deploys to production.
- Upstash Redis stores members, events, check-ins, links, photo settings, the exec roster, and delib votes.
- The club Google account, connected with OAuth, writes Google Sheets, reads Venmo emails, and sends Wallet card emails.

## Run it locally

Use local mode to try changes or fix bugs.
It runs the site against a private Redis database on your computer, so nothing you do reaches the real site.

```bash
brew install redis   # once
npm install
npm run dev:local
```

- The dashboard signs you in as `exec@mit.edu` without Google.
- Google, Wallet cards, and emails are off. On Membership, press "Start test year" to try signups, events, and check-in.
- Test data stays in `.local-data/` between runs. Delete that folder to start over.

`npm run dev` runs the site with the values in `.env.local`.
Copy `.env.example` to `.env.local` and fill in the values from Vercel (Settings > Environment Variables).
With production values, the local site reads and writes the live database and acts as the club Google account.
Use it only when a problem needs real data.
`DASHBOARD_DEV_EMAIL` signs you in to the dashboard without Google, in development only.

## Where things are

- Exec roster: the dashboard's Exec tab, with photos in the club Drive's "Website/Exec Photos" folder. Code: `src/lib/exec.ts`.
- The alumni name lists by year: `src/config/exec/alumni.ts` (`pastAlumni`).
- Footer and menu links: `src/config/links.ts`.
- Dashboard: `src/app/dashboard/`, `src/components/dashboard/`, and `src/lib/membership/`.
- Signup and Wallet cards: `src/app/join/` and `src/components/membership/`.
- Delibs: `src/components/voting/`, `src/app/api/voting/`, and `src/lib/voting/`. See [docs/deliberations.md](docs/deliberations.md).
- Cron jobs: `vercel.json`.

## Checks

```bash
npx tsc --noEmit
npm run lint
npm run test:links
npm run test:membership
npm run test:exec
npm run test:voting
npm run test:voting:redis
```

`test:voting:redis` needs `redis-server` and `redis-cli`.
