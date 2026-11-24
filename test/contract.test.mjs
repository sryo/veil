// Pins what veil must never contain: an unlock path, a login-policy change,
// a root component, a cover that stays at the lock screen or one opaque
// enough to stop pages painting. Also compiles veil.js with real osascript
// and runs its read-only self-test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { SOURCE } from "./helpers/core.mjs";

const ALL = SOURCE + readFileSync(new URL("../veil.mjs", import.meta.url), "utf8");

test("R9 no unlock, no authorization database, no root", () => {
  for (const bad of [/canBecomeVisibleWithoutLogin/, /Authorization(RightSet|ExecuteWithPrivileges|CreateFromExternalForm)/, /SecurityAgentPlugins/, /\bsudo\b/, /LaunchDaemons/, /with administrator privileges/i, /system\.login/]) {
    assert.doesNotMatch(ALL, bad, String(bad));
  }
});

test("R9 the cover is below full opacity, so pages under it keep painting", () => {
  const m = SOURCE.match(/const ALPHA = ([0-9.]+)/);
  assert.ok(m); assert.ok(Number(m[1]) < 1 && Number(m[1]) >= 0.999);
  assert.doesNotMatch(SOURCE, /\.opaque\s*=\s*true/);
});

test("R10 veil.js compiles and its self-test reads the Mac without changing it", () => {
  const out = JSON.parse(execFileSync("osascript", ["-l", "JavaScript", new URL("../veil.js", import.meta.url).pathname, "selftest"], { encoding: "utf8", timeout: 20000 }));
  assert.equal(out.ok, true);
  assert.equal(out.lockBinds, true);
  assert.ok(out.displays.length >= 1);
  assert.equal(typeof out.idle, "number");
  assert.equal(typeof out.locked, "boolean");
});
