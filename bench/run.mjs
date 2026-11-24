// The fake world: drives veil.js's holder and warden decisions through every
// trigger and every way a lock ends, with no osascript. Writes a run file.
//   node bench/run.mjs
import { core } from "../test/helpers/core.mjs";
import { save } from "./stamp.mjs";
const { holderStep, wardenStep, holderInit, wardenInit, K } = core();

const D = [{ id: 1, loft: false, mirrorOf: 0 }];
const r0 = (o) => ({ t: 0, idle: 5, displays: D, covered: [1], coverOk: true, ownerAlive: true, wardenAlive: true, down: false, locked: false, ...o });
function drive(step, s, rs) { const acts = []; for (const r of rs) { const o = step(s, r); s = o.s; acts.push(...o.act.map((a) => ({ ...a, t: r.t }))); } return { s, acts }; }
const armed = () => drive(holderStep, holderInit({ max: 3600 }), [r0({ t: 0, idle: 0.1 }), r0({ t: 0.1, idle: 0.2 }), r0({ t: 3, idle: 3 })]).s;
const ticks = (from, n, f) => Array.from({ length: n }, (_, i) => f(from + (i + 1) * K.TICK, (i + 1) * K.TICK));

// Every holder trigger, then every warden one: did it lock, and how many ticks after it showed?
const holderKinds = { input: { idle: 0.01 }, owner: { ownerAlive: false }, down: { down: true }, display: { displays: [...D, { id: 2, loft: false, mirrorOf: 0 }] }, cover: { coverOk: false }, warden: { wardenAlive: false }, max: { t: 3700, idle: 3699 } };
let locks = 0, kinds = 0, worstTicks = 0;
for (const [why, o] of Object.entries(holderKinds)) {
  kinds++;
  const rs = [r0({ t: 4, idle: 4, ...o }), ...ticks(4, 5, (t, d) => r0({ t, idle: d, ...o }))];
  const out = drive(holderStep, armed(), rs);
  const lk = out.acts.find((a) => a.kind === "lock" && a.why === why);
  if (lk) { locks++; worstTicks = Math.max(worstTicks, Math.round((lk.t - rs[0].t) / K.TICK)); }
}
const w = (o) => ({ t: 1, holderAlive: true, beatAge: 0.1, exitReason: null, locked: false, ...o });
const wardenKinds = { holder_gone: { holderAlive: false }, holder_stalled: { beatAge: K.BEAT_STALE + 0.2 }, max: { t: 1 + 60 + K.MAX_GRACE + 0.2 } };
let stalledKilled = 0;
for (const [why, o] of Object.entries(wardenKinds)) {
  kinds++;
  const out = drive(wardenStep, wardenInit({ max: 60 }), [w(), w(o)]);
  if (out.acts.some((a) => a.kind === "lock" && a.why === why)) locks++;
  if (why === "holder_stalled" && out.acts.some((a) => a.kind === "kill")) stalledKilled++;
}

// How a lock ends: taken, not taken; windows left, time to drop, anything after.
function ending(lockedAt) {
  let out = drive(holderStep, armed(), [r0({ t: 10, idle: 0.01 })]);
  const rs = ticks(10, 40, (t, d) => r0({ t, idle: d, locked: lockedAt !== null && d >= lockedAt - 1e-9 }));
  out = drive(holderStep, out.s, rs);
  const close = out.acts.find((a) => a.kind === "close"), exit = out.acts.find((a) => a.kind === "exit");
  const after = drive(holderStep, out.s, [r0({ t: 20, idle: 0.01, down: true }), r0({ t: 21, coverOk: false })]).acts.length;
  return { left: close && exit && close.t <= exit.t ? 0 : 1, drop: close ? close.t - 10 : 99, after };
}
const ok = ending(0.3), bad = ending(null);
let wardenLocksAfterClean = 0;
for (const why of ["locked", "lock_failed", "no_warden", "cover_failed"]) {
  const out = drive(wardenStep, wardenInit({ max: 60 }), [w(), w({ t: 2, holderAlive: false, exitReason: why })]);
  wardenLocksAfterClean += out.acts.filter((a) => a.kind === "lock").length;
}

const m = (dir, kind, v) => ({ dir, kind, samples: [v] });
save("run", {
  "windows left after a lock": m("lower", "quality", ok.left),
  "windows left after a failed lock": m("lower", "quality", bad.left),
  "seconds until a failed lock drops the cover": m("lower", "quality", Math.round(bad.drop * 10) / 10),
  "actions after the end": m("lower", "quality", ok.after + bad.after),
  "stalled holders the warden kills": m("higher", "quality", stalledKilled),
  "warden locks after a clean exit": m("lower", "quality", wardenLocksAfterClean),
  "triggers that lock": m("higher", "quality", locks),
  "triggers missed": m("lower", "quality", kinds - locks),
  "ticks from trigger to lock request": m("lower", "quality", worstTicks),
});
