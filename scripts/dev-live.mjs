// `npm run dev:live`: runs the site with the values in .env.local, pulled from Vercel.
// The site then reads and writes the live database and acts as the club Google account.
// Use `npm run dev` (local mode) unless a problem needs real data.
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import nextEnv from "@next/env";

const { combinedEnv: env } = nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });
const redis = (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) || (env.KV_REST_API_URL && env.KV_REST_API_TOKEN);
if (!redis || !env.MEMBERSHIP_SECRET) {
  console.error(`.env.local does not have the live values. Pull them while signed in to Vercel as the club account:

  npx vercel login                 # Continue with GitHub, as the club account
  npx vercel link                  # once: pick the mitcsc project
  npx vercel env pull .env.local   # the Development values
`);
  process.exit(1);
}

console.log(`
LIVE MODE: this site uses the live database and the club Google account.
Changes here reach the real site, and emails go to real members.
Use \`npm run dev\` instead unless you need real data.
`);
const prompt = createInterface({ input: process.stdin, output: process.stdout });
// Closed input (no terminal) counts as "no".
const answer = await new Promise((resolve) => {
  prompt.once("close", () => resolve(""));
  prompt.question("Type y to start in live mode: ").then(resolve, () => resolve(""));
});
prompt.close();
if (answer.trim().toLowerCase() !== "y") {
  console.log("Stopped. Nothing was started.");
  process.exit(1);
}

spawnSync(process.execPath, ["scripts/generate-event-images.mjs"], { stdio: "inherit" });

const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--turbopack", ...process.argv.slice(2)], { stdio: "inherit" });
process.on("SIGINT", () => next.kill("SIGINT"));
process.on("SIGTERM", () => next.kill("SIGTERM"));
next.on("exit", (code) => process.exit(code ?? 0));
