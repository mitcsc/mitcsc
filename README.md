# MIT CSC website

The website of the MIT Chinese Students Club, live at [csc.mit.edu](https://csc.mit.edu).
Exec manage members, events, links, home page photos, the exec and alumni pages, and delibs in the dashboard at [csc.mit.edu/dashboard](https://csc.mit.edu/dashboard).

[AGENTS.md](AGENTS.md) is the maintainers' technical guide, for people and AI assistants.
The club's maintenance guide (a Google Doc in the club Drive) covers how exec use the site and the dashboard.

## Stack

- Next.js 15 (App Router), React 19, TypeScript, and Tailwind v4.
- Hosted on Vercel. Every push to `main` deploys to production.
- Upstash Redis stores members, events, check-ins, links, photo settings, the exec roster, and delib votes.
- The club Google account, connected with OAuth, writes Google Sheets, reads Venmo emails, and sends Wallet card emails.

## Run it locally

`npm run dev` runs the site in local mode, with a private Redis database on your computer.
Nothing you do there reaches the real site.

```bash
brew install redis   # once
npm install
npm run dev
```

- The dashboard signs you in as `exec@mit.edu` without Google.
- Google, Wallet cards, and emails are off. On Membership, press "Start test year" to try signups, events, and check-in.
- Test data stays in `.local-data/` between runs. Delete that folder to start over.
- `PORT=3020 npm run dev` picks the port.

### Live mode

`npm run dev:live` runs the site with the live database and the club Google account.
Changes there reach the real site, and emails go to real members.
Use it only when a problem needs real data.

It needs the values in `.env.local`. Pull them from Vercel while signed in as the club account:

```bash
npx vercel login                 # Continue with GitHub, as the club account
npx vercel link                  # once: pick the mitcsc project
npx vercel env pull .env.local   # the Development values
```

`.env.example` lists every variable.

## Where things are

- Exec roster: the dashboard's Exec and Alumni tabs, with photos in the club Drive's "Website/Exec Photos/Active" and "Website/Exec Photos/Alumni" folders. A photo moves with its person. Code: `src/lib/exec.ts`.
- The alumni name lists by year: `src/config/past-alumni.ts`.
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
