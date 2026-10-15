# MIT CSC website

The website of the MIT Chinese Students Club, live at [csc.mit.edu](https://csc.mit.edu).
Exec manage members, events, links, home page photos, and delibs in the dashboard at [csc.mit.edu/dashboard](https://csc.mit.edu/dashboard).

The club's maintenance guide (a Google Doc in the club Drive) covers day-to-day changes and the dashboard.

## Stack

- Next.js 15 (App Router), React 19, TypeScript, and Tailwind v4.
- Hosted on Vercel. Every push to `main` deploys to production.
- Upstash Redis stores members, events, check-ins, links, photo settings, and delib votes.
- The club Google account, connected with OAuth, writes Google Sheets, reads Venmo emails, and sends Wallet card emails.

## Run it locally

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and fill in the values from Vercel (Settings > Environment Variables).
`DASHBOARD_DEV_EMAIL` signs you in to the dashboard without Google, in development only.
With production values, the local site reads and writes the live database.

## Where things are

- Exec roster: `src/config/exec/current.ts` and `src/config/exec/alumni.ts`, with photos in `public/img/exec/`.
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
npm run test:voting
npm run test:voting:redis
```

`test:voting:redis` needs `redis-server` and `redis-cli`.
