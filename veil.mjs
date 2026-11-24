#!/usr/bin/env node
// veil: cover every screen and lock the Mac on the first touch. Starts the
// holder and the warden (veil.js under osascript), keeps them in
// $VEIL_HOME/veil.json, and asks the holder to lock for `veil down`.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.VEIL_HOME || join(homedir(), "Library", "Application Support", "veil");
const OSA = process.env.VEIL_OSA ? JSON.parse(process.env.VEIL_OSA) : ["osascript", "-l", "JavaScript", join(ROOT, "veil.js")];
const CAFF = process.env.VEIL_CAFFEINATE ? JSON.parse(process.env.VEIL_CAFFEINATE) : ["caffeinate", "-d", "-i", "-w"];
const WAIT_MS = Number(process.env.VEIL_WAIT_MS || 5000);
const REC = join(HOME, "veil.json");
const args = process.argv.slice(2);
const json = args.includes("--json");

function out(o, human, code = 0) {
  if (json) console.log(JSON.stringify(o));
  else if (code === 0) console.log(human);
  else console.error(`veil: ${human}`);
  process.exit(code);
}
const fail = (code, error, exit = 1) => out({ ok: false, code, error }, error, exit);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] ?? ""; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
// A recorded pid counts only while ps still shows it running veil's holder.
function holderUp(r) {
  if (!r || !alive(r.pid)) return false;
  const p = spawnSync("ps", ["-o", "command=", "-p", String(r.pid)], { encoding: "utf8" });
  return / holder /.test(p.stdout) && p.stdout.includes(HOME);
}
const record = () => { try { return JSON.parse(readFileSync(REC, "utf8")); } catch { return null; } };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Starts one veil.js process and waits for its first JSON line.
function start(argv) {
  const child = spawn(OSA[0], [...OSA.slice(1), ...argv], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  return new Promise((ok) => {
    let buf = "";
    const t = setTimeout(() => ok({ child, line: null }), WAIT_MS);
    child.stdout.on("data", (d) => {
      buf += d;
      const nl = buf.indexOf("\n");
      if (nl >= 0) { clearTimeout(t); let line = null; try { line = JSON.parse(buf.slice(0, nl)); } catch {} ok({ child, line }); }
    });
    child.on("exit", () => { clearTimeout(t); setTimeout(() => ok({ child, line: null }), 50); });
  });
}
const stop = (c) => { try { process.kill(c.pid, "SIGKILL"); } catch {} };

async function up() {
  const dry = process.env.VEIL_DRY || "";
  if (!["", "lock", "fail", "watch"].includes(dry)) fail("bad_env", "VEIL_DRY is lock, fail or watch");
  if (process.env.VEIL_DISPLAYS && !dry) fail("bad_env", "VEIL_DISPLAYS works only with VEIL_DRY; a real veil covers every display");
  const ownerArg = opt("--owner");
  let owner = 0;
  if (ownerArg !== undefined) {
    owner = /^\d+$/.test(ownerArg) ? Number(ownerArg) : 0;
    if (!owner || !alive(owner)) fail("bad_owner", `--owner ${ownerArg} is not a running process`);
  }
  const maxArg = opt("--max");
  const minutes = maxArg === undefined ? 120 : Number(maxArg);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) fail("bad_max", "--max is whole minutes from 1 to 720");
  mkdirSync(HOME, { recursive: true });
  // One up at a time: the lock is a directory, taken over once it's older than an up can take.
  const lockDir = join(HOME, "up.lock");
  try { mkdirSync(lockDir); } catch {
    let age = 0; try { age = Date.now() - statSync(lockDir).mtimeMs; } catch {}
    if (age < 2 * WAIT_MS + 5000) fail("busy", "another veil up is starting; run veil status", 4);
  }
  process.on("exit", () => { try { rmSync(lockDir, { recursive: true, force: true }); } catch {} });
  if (holderUp(record())) fail("already_up", "a veil is already up (veil status)", 4);
  for (const f of ["down", "exit.json", "warden.json", "beat"]) rmSync(join(HOME, f), { force: true });
  const max = minutes * 60;
  const h = await start(["holder", HOME, String(owner), String(max)]);
  if (!h.line || !h.line.ok) { stop(h.child); fail(h.line?.code || "holder_timeout", h.line?.error || "the cover didn't come up in time; nothing was locked"); }
  const w = await start(["warden", HOME, String(h.line.pid), String(max)]);
  if (!w.line || !w.line.ok) { stop(w.child); stop(h.child); fail("holder_timeout", "the warden didn't start in time; the cover is gone and nothing was locked"); }
  const caff = spawn(CAFF[0], [...CAFF.slice(1), String(h.line.pid)], { detached: true, stdio: "ignore" });
  caff.on("error", () => {});
  for (const c of [h.child, w.child, caff]) { c.stdout?.destroy(); c.unref(); }
  const rec = { pid: h.line.pid, warden: w.line.pid, caffeinate: caff.pid, owner: owner || undefined, covered: h.line.covered, max, started: new Date().toISOString(), dry: dry || undefined };
  writeFileSync(REC, JSON.stringify(rec) + "\n");
  const n = rec.covered.length;
  out({ ok: true, up: true, ...rec }, `veil is up on ${n} screen${n === 1 ? "" : "s"}. Once you stop typing, any touch locks this Mac${owner ? `, and so does process ${owner} ending` : ""}. It locks after ${minutes} minutes at the latest.`);
}

function status() {
  const r = record();
  let last;
  try { last = JSON.parse(readFileSync(join(HOME, "exit.json"), "utf8")).why; } catch {}
  if (!holderUp(r)) out({ up: false, last }, last ? `no veil is up (the last one ended: ${last})` : "no veil is up");
  out({ up: true, ...r }, `veil is up since ${r.started} on ${r.covered.length} screen(s); it locks by ${new Date(Date.parse(r.started) + r.max * 1000).toLocaleTimeString()}`);
}

async function down() {
  const r = record();
  if (!holderUp(r)) fail("not_up", "no veil is up; lock with the menu's Lock Screen", 3);
  writeFileSync(join(HOME, "down"), "");
  const until = Date.now() + WAIT_MS + 4000;
  let why;
  while (Date.now() < until && !why) {
    try { why = JSON.parse(readFileSync(join(HOME, "exit.json"), "utf8")).why; } catch { await sleep(50); }
  }
  rmSync(REC, { force: true });
  if (why === "locked") out({ ok: true, why }, "Locked.");
  if (!why) fail("holder_timeout", "veil didn't answer; the warden locks the Mac if the holder is stuck");
  fail(why, `veil didn't lock (${why}): macOS didn't lock the screen, so the cover is gone; lock it with the menu's Lock Screen`);
}

const cmd = args[0];
if (cmd === "up") await up();
else if (cmd === "status") status();
else if (cmd === "down") await down();
else fail("usage", "usage: veil up [--owner <pid>] [--max <minutes>] | status | down  [--json]", 2);
