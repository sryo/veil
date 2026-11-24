// Pins the veil CLI against a fake holder and warden (test/fakes/fake-veil.mjs):
// what up, status and down print and refuse, and the record they keep.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = new URL("../veil.mjs", import.meta.url).pathname;
const FAKE = new URL("./fakes/fake-veil.mjs", import.meta.url).pathname;
function env(home, extra = {}) {
  return { ...process.env, VEIL_HOME: home, VEIL_OSA: JSON.stringify(["node", FAKE]), VEIL_CAFFEINATE: JSON.stringify(["sleep", "60"]), VEIL_WAIT_MS: "3000", ...extra };
}
const veil = (home, args, extra) => spawnSync("node", [CLI, ...args], { env: env(home, extra), encoding: "utf8", timeout: 15000 });
const fresh = () => mkdtempSync(join(tmpdir(), "veil-test-"));
function cleanup(home) {
  try { const r = JSON.parse(readFileSync(join(home, "veil.json"), "utf8")); for (const p of [r.pid, r.warden, r.caffeinate]) try { process.kill(p, "SIGKILL"); } catch {} } catch {}
  rmSync(home, { recursive: true, force: true });
}

test("R8 up covers, starts a warden and keeps a record; status reports it", (t) => {
  const home = fresh(); t.after(() => cleanup(home));
  const r = veil(home, ["up", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.up, true); assert.deepEqual(o.covered, [1]); assert.equal(o.max, 120 * 60);
  const rec = JSON.parse(readFileSync(join(home, "veil.json"), "utf8"));
  for (const k of ["pid", "warden", "caffeinate", "started", "max"]) assert.ok(rec[k], k);
  const s = JSON.parse(veil(home, ["status", "--json"]).stdout);
  assert.equal(s.up, true); assert.equal(s.pid, rec.pid);
});

test("R8 a second up is refused while one is up", (t) => {
  const home = fresh(); t.after(() => cleanup(home));
  assert.equal(veil(home, ["up"]).status, 0);
  const r = veil(home, ["up", "--json"]);
  assert.equal(r.status, 4);
  assert.equal(JSON.parse(r.stdout).code, "already_up");
});

test("R8 down asks the holder to lock and reports how it ended", (t) => {
  const home = fresh(); t.after(() => cleanup(home));
  assert.equal(veil(home, ["up"]).status, 0);
  const r = veil(home, ["down", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).why, "locked");
  assert.equal(JSON.parse(veil(home, ["status", "--json"]).stdout).up, false);
});

test("R8 down whose lock didn't take says so and exits 1", (t) => {
  const home = fresh(); t.after(() => cleanup(home));
  assert.equal(veil(home, ["up"], { FAKE_EXIT: "lock_failed" }).status, 0);
  const r = veil(home, ["down"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /didn't lock/);
});

test("R8 down with no veil up says so", (t) => {
  const home = fresh(); t.after(() => cleanup(home));
  const r = veil(home, ["down", "--json"]);
  assert.equal(r.status, 3);
  assert.equal(JSON.parse(r.stdout).code, "not_up");
});

test("R8 bad arguments are refused before anything starts", (t) => {
  const home = fresh(); t.after(() => cleanup(home));
  const gone = spawn("true"); 
  for (const [args, code, extra] of [
    [["up", "--owner", "999999"], "bad_owner"],
    [["up", "--owner", "abc"], "bad_owner"],
    [["up", "--max", "0"], "bad_max"],
    [["up", "--max", "721"], "bad_max"],
    [["up"], "bad_env", { VEIL_DISPLAYS: "5" }],
    [["up"], "bad_env", { VEIL_DRY: "maybe" }],
    [["sideways"], "usage"],
  ]) {
    const r = veil(home, [...args, "--json"], extra);
    assert.notEqual(r.status, 0, args.join(" "));
    assert.equal(JSON.parse(r.stdout).code, code, args.join(" "));
  }
  assert.equal(existsSync(join(home, "veil.json")), false);
  gone.kill();
});

test("R8 a holder that can't cover is reported and leaves nothing running", (t) => {
  const home = fresh(); t.after(() => cleanup(home));
  const r = veil(home, ["up", "--json"], { FAKE_VEIL: "fail" });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).code, "cover_failed");
  assert.equal(existsSync(join(home, "veil.json")), false);
});

test("R8 a warden that never answers stops the holder and fails up", (t) => {
  const home = fresh(); t.after(() => cleanup(home));
  const r = veil(home, ["up", "--json"], { FAKE_VEIL: "mute", VEIL_WAIT_MS: "800" });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).code, "holder_timeout");
  assert.equal(existsSync(join(home, "veil.json")), false);
});

test("R8 two ups at once start one veil", async (t) => {
  const home = fresh(); t.after(() => cleanup(home));
  const run = () => new Promise((ok) => { const c = spawn("node", [CLI, "up", "--json"], { env: env(home) }); let o = ""; c.stdout.on("data", (d) => (o += d)); c.on("exit", (code) => ok({ code, o: JSON.parse(o) })); });
  const rs = await Promise.all([run(), run(), run()]);
  assert.equal(rs.filter((r) => r.code === 0).length, 1, JSON.stringify(rs));
  for (const r of rs.filter((r) => r.code !== 0)) assert.match(r.o.code, /^(already_up|busy)$/);
});
