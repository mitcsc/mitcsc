// `npm run dev` (local mode): runs the site against a private Redis on this computer instead of the live database.
// Google, Wallet cards, and emails are turned off, so nothing here can reach real members or club files.
// Data stays in .local-data/ between runs. Delete that folder to start over.
// PORT=3020 npm run dev picks the port. `npm run dev:live` uses the live database instead.
// Needs redis-server (macOS: `brew install redis`).
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { join } from "node:path";

const root = process.cwd();
const dataDir = join(root, ".local-data");
const devEmail = "exec@mit.edu";

if (spawnSync("redis-server", ["--version"]).error) {
  console.error("redis-server is not installed. On a Mac, run: brew install redis");
  process.exit(1);
}
mkdirSync(dataDir, { recursive: true });

// Kept between runs so dashboard sign-ins and member cookies stay valid after a restart.
const secretFile = join(dataDir, "membership-secret");
if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(32).toString("hex"));
const membershipSecret = readFileSync(secretFile, "utf8").trim();

function freePort(from = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => (error.code === "EADDRINUSE" && from ? resolve(freePort(from + 1)) : reject(error)));
    server.listen(from, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const children = [];
function stop(code = 0) {
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  process.exitCode = code;
  setTimeout(() => process.exit(code), 3000).unref();
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
process.on("exit", () => children.forEach((child) => child.exitCode === null && child.kill("SIGTERM")));

const redisPort = await freePort();
const redisServer = spawn("redis-server", [
  "--port", String(redisPort), "--bind", "127.0.0.1", "--dir", dataDir,
  "--appendonly", "yes", "--save", "", "--protected-mode", "yes",
], { stdio: "ignore" });
children.push(redisServer);
redisServer.on("exit", (code) => {
  if (code) console.error(`redis-server stopped with code ${code}.`);
  stop(code || 0);
});

// A minimal Redis client (RESP2). Replies arrive in the order commands were sent.
function connectRedis() {
  return new Promise((resolve, reject) => {
    const socket = net.connect(redisPort, "127.0.0.1");
    const waiting = [];
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (let parsed; (parsed = parseReply(buffer, 0)); ) {
        buffer = buffer.subarray(parsed.end);
        waiting.shift()(parsed.value);
      }
    });
    socket.once("connect", () => resolve((args) => new Promise((done) => {
      waiting.push(done);
      socket.write(encode(args));
    })));
    socket.once("error", reject);
  });
}

function encode(args) {
  const parts = [Buffer.from(`*${args.length}\r\n`)];
  for (const arg of args) {
    const value = Buffer.from(String(arg));
    parts.push(Buffer.from(`$${value.length}\r\n`), value, Buffer.from("\r\n"));
  }
  return Buffer.concat(parts);
}

// Returns { value, end }, or null when the reply is not complete yet. An error reply becomes { error }.
function parseReply(buffer, start) {
  const lineEnd = buffer.indexOf("\r\n", start);
  if (lineEnd < 0) return null;
  const type = String.fromCharCode(buffer[start]);
  const line = buffer.toString("utf8", start + 1, lineEnd);
  const next = lineEnd + 2;
  if (type === "+") return { value: line, end: next };
  if (type === "-") return { value: { error: line }, end: next };
  if (type === ":") return { value: Number(line), end: next };
  if (type === "$") {
    const length = Number(line);
    if (length < 0) return { value: null, end: next };
    if (buffer.length < next + length + 2) return null;
    return { value: buffer.toString("utf8", next, next + length), end: next + length + 2 };
  }
  if (type === "*") {
    const count = Number(line);
    if (count < 0) return { value: null, end: next };
    const items = [];
    let end = next;
    for (let i = 0; i < count; i++) {
      const item = parseReply(buffer, end);
      if (!item) return null;
      items.push(item.value);
      end = item.end;
    }
    return { value: items, end };
  }
  throw new Error(`Unexpected Redis reply type "${type}"`);
}

async function waitForRedis() {
  for (let i = 0; i < 50; i++) {
    try {
      const send = await connectRedis();
      if ((await send(["PING"])) === "PONG") return send;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("redis-server did not start.");
}

// The same HTTP shape as Upstash's REST API, which is all the app uses: POST / and POST /pipeline.
const send = await waitForRedis();
const restToken = randomBytes(24).toString("hex");
const result = (reply) => (reply?.error ? { error: reply.error } : { result: reply });
const rest = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", async () => {
    response.setHeader("Content-Type", "application/json");
    if (request.method !== "POST" || request.headers.authorization !== `Bearer ${restToken}`) {
      response.statusCode = 401;
      return response.end(JSON.stringify({ error: "Unauthorized" }));
    }
    try {
      const input = JSON.parse(body);
      if (request.url === "/pipeline") {
        const replies = await Promise.all(input.map((command) => send(command)));
        return response.end(JSON.stringify(replies.map(result)));
      }
      const reply = result(await send(input));
      if (reply.error) response.statusCode = 400;
      response.end(JSON.stringify(reply));
    } catch (error) {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: String(error.message || error) }));
    }
  });
});
const restPort = await freePort();
await new Promise((resolve) => rest.listen(restPort, "127.0.0.1", resolve));

spawnSync(process.execPath, ["scripts/generate-event-images.mjs"], { stdio: "inherit" });

const sitePort = Number(process.env.PORT) || (await freePort(3000));
// Next.js does not replace a variable that is already set, even to "", so these win over .env.local.
const env = {
  ...process.env,
  UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${restPort}`,
  UPSTASH_REDIS_REST_TOKEN: restToken,
  KV_REST_API_URL: "",
  KV_REST_API_TOKEN: "",
  GOOGLE_OAUTH_CLIENT_ID: "",
  GOOGLE_OAUTH_CLIENT_SECRET: "",
  WALLETWALLET_API_KEY: "",
  CRON_SECRET: "",
  MEMBERSHIP_SECRET: membershipSecret,
  DASHBOARD_DEV_EMAIL: devEmail,
  CSC_LOCAL_MODE: "1",
};
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--turbopack", "-p", String(sitePort), ...process.argv.slice(2)], { env, stdio: "inherit" });
children.push(next);
next.on("exit", (code) => stop(code || 0));

console.log(`
Local mode: the site uses a private database in .local-data/, not the live one.
Google, Wallet cards, and emails are off.
Site:      http://localhost:${sitePort}
Dashboard: http://localhost:${sitePort}/dashboard (signed in as ${devEmail})
`);
