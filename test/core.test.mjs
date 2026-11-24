// Pins the holder's and the warden's decisions (holderStep, wardenStep in
// veil.js), run under node:vm with no osascript: when each trigger locks,
// what a lock that takes or doesn't take leaves behind, and that nothing
// comes back after the end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { core } from "./helpers/core.mjs";

const { holderStep, wardenStep, holderInit, wardenInit, K } = core();
const D = [{ id: 1, loft: false, mirrorOf: 0 }];
const base = (o = {}) => ({ t: 0, idle: 5, displays: D, covered: [1], coverOk: true, ownerAlive: true, wardenAlive: true, down: false, locked: false, ...o });

// Runs the holder from `s` through readings until `until` (or one tick).
function drive(s, rs) { const acts = []; for (const r of rs) { const o = holderStep(s, r); s = o.s; acts.push(...o.act); } return { s, acts }; }
function ready(o = {}) { return drive(holderInit({ max: 7200, ...o }), [base({ t: 0, idle: 0.1 }), base({ t: 0.1, idle: 0.2 })]).s; }
function armed() { return drive(ready(), [base({ t: 3, idle: K.ARM_IDLE + 0.5 })]).s; }
const kinds = (acts) => acts.map((a) => a.kind);

test("R1 input after arming locks; input while arming doesn't", () => {
  let s = ready();
  assert.equal(s.phase, "arming");
  let o = drive(s, [base({ t: 0.5, idle: 0.05 })]);
  assert.deepEqual(kinds(o.acts), []);
  s = armed();
  assert.equal(s.phase, "armed");
  o = drive(s, [base({ t: 3.1, idle: 0.02 })]);
  assert.deepEqual(kinds(o.acts), ["lock"]);
  assert.equal(o.acts[0].why, "input");
});

test("R1 the idle counter climbing is not input", () => {
  const o = drive(armed(), [base({ t: 3.1, idle: 2.6 }), base({ t: 3.2, idle: 2.7 }), base({ t: 60, idle: 59 })]);
  assert.deepEqual(kinds(o.acts), []);
});

for (const [why, r] of [
  ["owner", { ownerAlive: false }],
  ["down", { down: true }],
  ["display", { displays: [...D, { id: 2, loft: false, mirrorOf: 0 }] }],
  ["cover", { coverOk: false }],
  ["warden", { wardenAlive: false }],
  ["max", { t: 7300, idle: 7299 }],
]) {
  test(`R2 ${why} locks, armed or still arming`, () => {
    for (const s of [ready(), armed()]) {
      const o = drive(s, [base({ t: 4, idle: 0.01, ...r })]);
      assert.deepEqual(kinds(o.acts), ["lock"], why);
      assert.equal(o.acts[0].why, why);
    }
  });
}

test("R2 a loft display and a mirror of a covered display don't lock", () => {
  const o = drive(armed(), [base({ t: 4, idle: 4, displays: [...D, { id: 9, loft: true, mirrorOf: 0 }, { id: 3, loft: false, mirrorOf: 1 }] })]);
  assert.deepEqual(kinds(o.acts), []);
});

test("R3 a lock that takes closes the cover and ends", () => {
  let o = drive(armed(), [base({ t: 4, idle: 0.01, down: true })]);
  o = drive(o.s, [base({ t: 4.1, idle: 0.1 }), base({ t: 4.3, idle: 0.3, locked: true })]);
  assert.deepEqual(kinds(o.acts), ["close", "exit"]);
  assert.equal(o.acts[1].why, "locked");
});

test("R3 a lock that doesn't take tries pmset, then drops the cover within 3s", () => {
  let o = drive(armed(), [base({ t: 10, idle: 0.01, down: true })]);
  const ticks = [];
  for (let i = 1; i <= 31; i++) ticks.push(base({ t: 10 + i / 10, idle: i / 10 }));
  o = drive(o.s, ticks);
  assert.deepEqual(kinds(o.acts), ["pmset", "close", "exit"]);
  assert.equal(o.acts[2].why, "lock_failed");
  assert.equal(o.s.phase, "done");
});

test("R4 no warden within its wait ends without locking", () => {
  const o = drive(holderInit({ max: 7200 }), [base({ t: 0, wardenAlive: null }), base({ t: K.PARTNER_WAIT + 0.1, wardenAlive: null })]);
  assert.deepEqual(kinds(o.acts), ["close", "exit"]);
  assert.equal(o.acts[1].why, "no_warden");
});

test("R4 a cover that never checks out ends without locking", () => {
  const o = drive(holderInit({ max: 7200 }), [base({ t: 0, coverOk: false }), base({ t: K.PARTNER_WAIT + 0.1, coverOk: false })]);
  assert.deepEqual(kinds(o.acts), ["close", "exit"]);
  assert.equal(o.acts[1].why, "cover_failed");
});

test("R4 someone locking the Mac by hand ends the veil", () => {
  const o = drive(armed(), [base({ t: 5, idle: 0.01, locked: true })]);
  assert.deepEqual(kinds(o.acts), ["close", "exit"]);
  assert.equal(o.acts[1].why, "locked");
});

test("R6 nothing comes back after the end", () => {
  let o = drive(armed(), [base({ t: 4, idle: 0.01, down: true }), base({ t: 4.2, idle: 0.2, locked: true })]);
  assert.equal(o.s.phase, "done");
  o = drive(o.s, [base({ t: 5, idle: 0.01, down: true }), base({ t: 9, locked: false, idle: 0.01, coverOk: false })]);
  assert.deepEqual(o.acts, []);
});

test("R7 a dry watch still locks for every other trigger", () => {
  const s = armed(); s.dry = "watch";
  const o = drive(s, [base({ t: 4, idle: 4, down: true })]);
  assert.deepEqual(kinds(o.acts), ["lock"]);
});

test("R7 a dry watch logs the lock input would make and rearms", () => {
  const s = armed(); s.dry = "watch";
  const o = drive(s, [base({ t: 4, idle: 0.03 })]);
  assert.deepEqual(kinds(o.acts), ["would_lock"]);
  assert.equal(o.acts[0].idle, 0.03);
  assert.equal(o.s.phase, "arming");
});

const w = (o = {}) => ({ t: 1, holderAlive: true, beatAge: 0.1, exitReason: null, locked: false, ...o });
function wdrive(s, rs) { const acts = []; for (const r of rs) { const o = wardenStep(s, r); s = o.s; acts.push(...o.act); } return { s, acts }; }

test("R5 the holder gone without a clean exit locks", () => {
  const o = wdrive(wardenInit({ max: 7200 }), [w(), w({ t: 2, holderAlive: false })]);
  assert.deepEqual(kinds(o.acts), ["lock"]);
});

test("R5 a stalled holder is killed, then the Mac locks", () => {
  const o = wdrive(wardenInit({ max: 7200 }), [w(), w({ t: 3, beatAge: K.BEAT_STALE + 0.1 })]);
  assert.deepEqual(kinds(o.acts), ["kill", "lock"]);
});

test("R5 past the time limit the warden kills the holder and locks", () => {
  const o = wdrive(wardenInit({ max: 60 }), [w(), w({ t: 1 + 60 + K.MAX_GRACE + 0.1 })]);
  assert.deepEqual(kinds(o.acts), ["kill", "lock"]);
});

for (const why of ["locked", "lock_failed", "no_warden", "cover_failed"]) {
  test(`R5 a clean holder exit (${why}) ends the warden without locking`, () => {
    const o = wdrive(wardenInit({ max: 7200 }), [w(), w({ t: 2, holderAlive: false, exitReason: why })]);
    assert.deepEqual(kinds(o.acts), ["exit"]);
  });
}

test("R5 the warden's lock that takes or doesn't, ends it", () => {
  let o = wdrive(wardenInit({ max: 7200 }), [w({ holderAlive: false })]);
  o = wdrive(o.s, [w({ t: 1.5, holderAlive: false, locked: true })]);
  assert.deepEqual(kinds(o.acts), ["exit"]);
  o = wdrive(wardenInit({ max: 7200 }), [w({ holderAlive: false })]);
  const ticks = []; for (let i = 1; i <= 31; i++) ticks.push(w({ t: 1 + i / 10, holderAlive: false }));
  o = wdrive(o.s, ticks);
  assert.deepEqual(kinds(o.acts), ["pmset", "exit"]);
  assert.equal(o.s.phase, "done");
});

test("R10 display ids decode from the buffer's base64", () => {
  const { u32s } = core();
  assert.deepEqual([...u32s(Buffer.from(Uint32Array.from([1, 261, 0, 4294967295]).buffer).toString("base64"))], [1, 261, 0, 4294967295]);
  assert.deepEqual([...u32s("AgAAAA==")], [2]);
});
