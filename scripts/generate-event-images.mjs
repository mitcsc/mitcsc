// Writes the list of event photos to src/generated/event-images.json.
// The home page imports this list so the server can pick random photos
// without reading the filesystem at request time. Vercel does not ship the
// public/ directory inside the serverless function, so a runtime readdir
// would return nothing once the page regenerates through ISR.
import { readdir, writeFile, readFile } from "fs/promises";
import { join } from "path";

const root = process.cwd();
const dir = join(root, "public", "img", "event");
const out = join(root, "src", "generated", "event-images.json");
const extensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"];

const files = (await readdir(dir))
  .filter((file) => extensions.some((ext) => file.toLowerCase().endsWith(ext)))
  .sort();

const next = JSON.stringify(files, null, 2) + "\n";
const current = await readFile(out, "utf8").catch(() => "");
if (current !== next) {
  await writeFile(out, next);
  console.log(`event-images: wrote ${files.length} entries to src/generated/event-images.json`);
}
