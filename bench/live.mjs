// The live bench, out of the user's sight: veil covers only a loft (dry run,
// the lock stubbed), over a Safari tab perch opened there on a 127.0.0.1
// page. Measures what the page and perch's background input do under the
// veil, what a stubbed lock, a failed one, a stalled and a killed holder
// leave behind, and what veil costs. With --real, and only while the user is
// away (`fium away`), it also locks the Mac for real once and counts veil
// windows left on the lock screen.
//   node bench/live.mjs [--real]
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { save } from "./stamp.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const PERCH = process.env.PERCH_DIR || join(process.env.HOME, "Documents", "perch");
const { connect, text } = await import(join(PERCH, "scripts", "mcp-client.mjs"));
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const osa = (src) => execFileSync("osascript", ["-l", "JavaScript", "-e", src], { encoding: "utf8" }).trim();
const probe = () => JSON.parse(osa(`ObjC.import("AppKit"); ObjC.import("CoreGraphics"); const p=$.CGEventGetLocation($.CGEventCreate(null)); JSON.stringify({ front: ObjC.unwrap($.NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier), cursor: [Math.round(p.x), Math.round(p.y)], idle: Math.min(...[1, 3, 25, 5, 6, 7, 27, 10, 12, 22, 23, 24].map((t) => Number($.CGEventSourceSecondsSinceLastEventType(1, t)))) })`));
const windowsOf = (pid) => Number(osa(`ObjC.import("CoreGraphics"); (ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(0, 0))) || []).filter((w) => w.kCGWindowOwnerPID === ${pid}).length`));
const lofts = () => JSON.parse(execFileSync("loft", ["list", "--json"], { encoding: "utf8" }));
function veil(home, env, ...args) {
  const r = spawnSync("node", [join(ROOT, "veil.mjs"), ...args, "--json"], { env: { ...process.env, VEIL_HOME: home, ...env }, encoding: "utf8", timeout: 20000 });
  try { return JSON.parse(r.stdout); } catch { return { ok: false, error: r.stderr || r.stdout }; }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(f, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await sleep(50); } return f(); }

const html = `<title>veil bench</title><button id=b style="font-size:30px;margin:40px">b</button><input id=i style="font-size:30px">
<script>window.F=0;(function t(){F++;requestAnimationFrame(t)})();window.log=[];b.onclick=e=>log.push('c'+e.isTrusted);i.onkeydown=e=>log.push('k'+e.isTrusted)</script>`;
const srv = createServer((q, r) => { r.writeHead(200, { "content-type": "text/html" }); r.end(html); });
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const metrics = {}, put = (name, dir, kind, v, noisy) => (metrics[name] = { dir, kind, samples: [].concat(v), ...(noisy ? { noisy: true } : {}) });
const fg0 = probe();
const c = await connect({ timeoutMs: 30000 });
const J = (r) => { const t = text(r); try { return JSON.parse(t); } catch { return t; } };
let tabId, homes = [];
try {
  const before = new Set(lofts().map((l) => l.displayId));
  const nt = J(await c.call("new_tab", { url: `http://127.0.0.1:${srv.address().port}/`, loft: "1280x800" }));
  tabId = nt.tabId; const target = { tabId };
  const loft = lofts().find((l) => !before.has(l.displayId));
  if (!tabId || !loft) throw new Error(`no loft tab: ${JSON.stringify(nt)}`);
  const dry = (mode) => ({ VEIL_DRY: mode, VEIL_DISPLAYS: String(loft.displayId) });
  const ev = async (s) => J(await c.call("eval_js", { script: s, target }));

  // Up, and the page under the veil.
  const home = mkdtempSync(join(tmpdir(), "veil-bench-")); homes.push(home);
  const t0 = Date.now(); const up = veil(home, dry("watch"), "up", "--max", "10");
  put("veil up ms", "lower", "time", Date.now() - t0, true);
  if (!up.ok) throw new Error(`veil up: ${JSON.stringify(up)}`);
  await sleep(1000);
  const p1 = await ev("({v:document.visibilityState,F})"); await sleep(1000); const p2 = await ev("F");
  put("page visible under the veil", "higher", "quality", p1.v === "visible" ? 1 : 0);
  put("frames per second under the veil", "higher", "quality", p2 - p1.F, true);
  let clicks = 0, presses = 0, resets = 0;
  for (let k = 0; k < 5; k++) {
    // A drop in the idle counter across one call, while the user was idle
    // (over 3s) and the cursor didn't move, is the agent's input.
    for (const [kind, args] of [["click", { target, selector: "#b", trusted: true }], ["press", { target, selector: "#i", key: "a", trusted: true }]]) {
      const a = probe(), r = J(await c.call(kind, args)), b = probe();
      if (r.hit === true) kind === "click" ? clicks++ : presses++;
      if (process.env.VEIL_BENCH_TRACE) console.error(JSON.stringify({ a, b, delivery: r.delivery, aim: r.aim }));
      if (a.idle > 3 && b.idle < a.idle && a.cursor.join() === b.cursor.join()) resets++;
    }
  }
  const log = await ev("log.splice(0)");
  put("trusted clicks that hit under the veil, of 5", "higher", "quality", Math.min(clicks, log.filter((x) => x === "ctrue").length));
  put("trusted presses that hit under the veil, of 5", "higher", "quality", Math.min(presses, log.filter((x) => x === "ktrue").length));
  put("idle-counter resets from the agent's input", "lower", "quality", resets, true);
  const pid = up.pid;
  const ps1 = spawnSync("ps", ["-o", "rss=,time=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim().split(/\s+/);
  await sleep(10000);
  const ps2 = spawnSync("ps", ["-o", "rss=,time=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim().split(/\s+/);
  const secs = (s) => s.split(":").reduce((a, x) => a * 60 + Number(x), 0);
  put("holder memory MB", "lower", "bytes", Math.round(Number(ps2[0]) / 1024), true);
  put("holder CPU seconds per minute", "lower", "time", Math.round((secs(ps2[1]) - secs(ps1[1])) * 6 * 100) / 100, true);

  // A stubbed lock that takes: nothing left.
  const down = veil(home, {}, "down");
  await until(() => !alive(pid) && !alive(up.warden), 5000);
  put("windows left after a lock (stubbed)", "lower", "quality", (alive(pid) ? windowsOf(pid) : 0) + (alive(up.warden) ? 1 : 0) + (down.why === "locked" ? 0 : 1));

  // A lock that never takes: the cover drops on its own.
  const h2 = mkdtempSync(join(tmpdir(), "veil-bench-")); homes.push(h2);
  const u2 = veil(h2, dry("fail"), "up", "--max", "10");
  const t2 = Date.now(); const d2 = veil(h2, {}, "down");
  await until(() => !alive(u2.pid), 6000);
  put("seconds until a failed lock drops the cover", "lower", "quality", Math.round((Date.now() - t2) / 100) / 10);
  put("windows left after a failed lock", "lower", "quality", (alive(u2.pid) ? windowsOf(u2.pid) : 0) + ((d2.why || d2.code) === "lock_failed" ? 0 : 1));

  // A stalled holder (SIGSTOP), then a killed one: the warden steps in.
  for (const [name, sig] of [["stalled", "SIGSTOP"], ["killed", "SIGKILL"]]) {
    const h = mkdtempSync(join(tmpdir(), "veil-bench-")); homes.push(h);
    const u = veil(h, dry("watch"), "up", "--max", "10");
    await sleep(500);
    const t = Date.now(); process.kill(u.pid, sig);
    await until(() => existsSync(join(h, "log.jsonl")) && readFileSync(join(h, "log.jsonl"), "utf8").includes('"who":"warden","ev":"lock"'), 5000);
    put(`seconds until the warden locks for a ${name} holder`, "lower", "time", Math.round((Date.now() - t) / 100) / 10, true);
    await until(() => !alive(u.pid) && !alive(u.warden), 6000);
    put(`windows left after a ${name} holder`, "lower", "quality", (alive(u.pid) ? windowsOf(u.pid) : 0) + (alive(u.warden) ? 1 : 0));
  }

  if (process.argv.includes("--real")) {
    const away = spawnSync("fium", ["away"]);
    if (away.status !== 0) console.error("live: --real skipped, the user is here (fium away)");
    else {
      const h = mkdtempSync(join(tmpdir(), "veil-bench-")); homes.push(h);
      const u = veil(h, {}, "up", "--max", "5");
      await sleep(1500);
      const d = veil(h, {}, "down");
      await sleep(1500);
      put("veil windows left on the real lock screen", "lower", "quality", (alive(u.pid) ? windowsOf(u.pid) : 0) + (d.why === "locked" ? 0 : 1));
    }
  }
} catch (e) { console.error(`live: ${e.stack || e}`); process.exitCode = 1; }
finally {
  if (tabId) try { await c.call("close_tab", { tabId }); } catch {}
  for (const h of homes) try { const r = JSON.parse(readFileSync(join(h, "veil.json"), "utf8")); for (const p of [r.pid, r.warden, r.caffeinate]) try { process.kill(p, "SIGKILL"); } catch {} } catch {}
  c.close(); srv.close();
  const fg1 = probe();
  put("foreground app changes", "lower", "quality", fg0.front === fg1.front ? 0 : 1);
  if (!process.exitCode) save("live", metrics);
  process.exit(process.exitCode || 0);
}
