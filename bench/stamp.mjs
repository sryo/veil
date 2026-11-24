// Stamps and writes a bench run (fium's run format) under ~/.fium/runs/veil/,
// and prints its path as the last line.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const git = (...a) => { try { return execFileSync("git", a, { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
export function save(kind, metrics, extra = {}) {
  const commit = git("rev-parse", "HEAD");
  const dirty = commit ? git("status", "--porcelain") !== "" : false;
  const dir = join(process.env.FIUM_HOME || join(homedir(), ".fium"), "runs", "veil");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${kind}-${(commit ?? "unstamped").slice(0, 12)}${dirty ? "-dirty" : ""}.json`);
  writeFileSync(out, JSON.stringify({ commit, dirty, ...extra, metrics, limits: {} }, null, 2));
  console.log(out);
}
