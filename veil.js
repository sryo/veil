// veil's holder and warden, run as
//   osascript -l JavaScript veil.js holder HOME OWNER MAXSECS
//   osascript -l JavaScript veil.js warden HOME HOLDERPID MAXSECS
//   osascript -l JavaScript veil.js selftest
// The holder covers every physical display and locks the Mac on the first
// input once armed, or on any other trigger; the warden locks if the holder
// dies or stalls. Neither ever unlocks: once the Mac is locked, or a lock
// can't be made, both close and exit. The decisions are the pure functions
// below (tested under node:vm); the glue that reads the Mac is inside run().

const K = {
  TICK: 0.1,          // seconds between readings
  ARM_IDLE: 2,        // seconds of no input before input counts as a touch
  PARTNER_WAIT: 5,    // seconds the holder waits for its warden and its cover
  BEAT_STALE: 1.5,    // seconds without a holder heartbeat before the warden acts
  PMSET_AFTER: 1,     // seconds after the lock request before the fallback
  LOCK_WAIT: 3,       // seconds a lock has to take before the cover drops
  MAX_GRACE: 5,       // seconds past the time limit before the warden steps in
  INPUT_EPS: 0.05,    // an idle counter drop smaller than this is noise
};
// Under 1, so WindowServer doesn't count pages under it as covered (they'd
// stop painting and refuse trusted clicks); 0.001 of a pixel rounds to black.
const ALPHA = 0.999;

function holderInit(o) { return { phase: "starting", t0: null, lastIdle: null, max: o.max, dry: o.dry || "", lockAt: 0, pmset: false }; }

// One reading in, the state and the actions out. r: {t, idle, displays:
// [{id, loft, mirrorOf}], covered, coverOk, ownerAlive, wardenAlive (null:
// not seen yet), down, locked}.
function holderStep(s, r) {
  s = Object.assign({}, s);
  const act = [];
  const end = (why) => { act.push({ kind: "close" }, { kind: "exit", why }); s.phase = "done"; };
  if (s.phase === "done") return { s, act };
  if (s.t0 === null) s.t0 = r.t;
  const prev = s.lastIdle;
  s.lastIdle = r.idle;
  if (s.phase === "locking") {
    if (r.locked) end("locked");
    else if (r.t - s.lockAt >= K.LOCK_WAIT - 1e-9) end("lock_failed");
    else if (!s.pmset && r.t - s.lockAt >= K.PMSET_AFTER - 1e-9) { s.pmset = true; act.push({ kind: "pmset" }); }
    return { s, act };
  }
  if (r.locked) { end("locked"); return { s, act }; }
  if (s.phase === "starting") {
    if (r.wardenAlive && r.coverOk && !uncovered(r).length) s.phase = "arming";
    else if (r.t - s.t0 >= K.PARTNER_WAIT) end(r.coverOk && !uncovered(r).length ? "no_warden" : "cover_failed");
    return { s, act };
  }
  let why = null;
  if (r.down) why = "down";
  else if (!r.ownerAlive) why = "owner";
  else if (!r.wardenAlive) why = "warden";
  else if (!r.coverOk) why = "cover";
  else if (uncovered(r).length) why = "display";
  else if (r.t - s.t0 >= s.max) why = "max";
  else if (s.phase === "armed" && prev !== null && r.idle + K.INPUT_EPS < prev) why = "input";
  if (why) {
    if (s.dry === "watch" && why === "input") { act.push({ kind: "would_lock", why, idle: r.idle }); s.phase = "arming"; return { s, act }; }
    act.push({ kind: "lock", why }); s.phase = "locking"; s.lockAt = r.t;
    return { s, act };
  }
  if (s.phase === "arming" && r.idle >= K.ARM_IDLE) s.phase = "armed";
  return { s, act };
}

// Physical displays nothing covers: not a loft, and not a mirror of a covered one.
function uncovered(r) {
  return r.displays.filter((d) => !d.loft && r.covered.indexOf(d.id) < 0 && !(d.mirrorOf && r.covered.indexOf(d.mirrorOf) >= 0)).map((d) => d.id);
}

function wardenInit(o) { return { phase: "watching", t0: null, max: o.max, lockAt: 0, pmset: false }; }

// r: {t, holderAlive, beatAge, exitReason (the holder's own, or null), locked}.
function wardenStep(s, r) {
  s = Object.assign({}, s);
  const act = [];
  if (s.phase === "done") return { s, act };
  if (s.t0 === null) s.t0 = r.t;
  if (s.phase === "locking") {
    if (r.locked || r.t - s.lockAt >= K.LOCK_WAIT - 1e-9) { act.push({ kind: "exit", why: r.locked ? "locked" : "lock_failed" }); s.phase = "done"; }
    else if (!s.pmset && r.t - s.lockAt >= K.PMSET_AFTER - 1e-9) { s.pmset = true; act.push({ kind: "pmset" }); }
    return { s, act };
  }
  if (r.exitReason || (r.locked && !r.holderAlive)) { act.push({ kind: "exit", why: r.exitReason || "locked" }); s.phase = "done"; return { s, act }; }
  const stalled = r.holderAlive && r.beatAge > K.BEAT_STALE;
  const late = r.holderAlive && r.t - s.t0 >= s.max + K.MAX_GRACE;
  if (!r.holderAlive || stalled || late) {
    if (r.holderAlive) act.push({ kind: "kill" });
    act.push({ kind: "lock", why: !r.holderAlive ? "holder_gone" : stalled ? "holder_stalled" : "max" });
    s.phase = "locking"; s.lockAt = r.t;
  }
  return { s, act };
}

// ---- JXA glue: everything below reads or changes the Mac. ----

function run(argv) {
  ObjC.import("AppKit");
  ObjC.import("CoreGraphics");
  ObjC.import("stdlib");
  ObjC.bindFunction("kill", ["int", ["int", "int"]]);
  ObjC.bindFunction("getpid", ["int", []]);
  ObjC.bindFunction("CGGetActiveDisplayList", ["int", ["unsigned int", "void *", "void *"]]);
  ObjC.bindFunction("IORegistryGetRootEntry", ["unsigned int", ["unsigned int"]]);
  ObjC.bindFunction("IORegistryEntryCreateCFProperty", ["id", ["unsigned int", "id", "void *", "unsigned int"]]);
  const env = ObjC.deepUnwrap($.NSProcessInfo.processInfo.environment);
  const mode = argv[0];
  // An asleep main display (a locked, idle Mac) lists no active displays.
  if (mode === "selftest") return JSON.stringify({ ok: true, lockBinds: bindLock(), displays: displays(), asleep: Number($.CGDisplayIsAsleep($.CGMainDisplayID())) === 1, idle: idle(), locked: sessionLocked() });
  const home = argv[1];
  const dry = env.VEIL_DRY || "";
  // A dry run may cover only the displays it names (a loft, so nobody sees it),
  // which then count as physical.
  const only = dry && env.VEIL_DISPLAYS ? env.VEIL_DISPLAYS.split(",").map(Number) : null;
  const screens = () => only ? displays().filter((d) => only.indexOf(d.id) >= 0).map((d) => Object.assign(d, { loft: false })) : displays();
  const now = () => Date.now() / 1000;
  const path = (f) => home + "/" + f;
  const alive = (pid) => pid > 0 && $.kill(pid, 0) === 0;
  const log = (o) => append(path("log.jsonl"), JSON.stringify(Object.assign({ at: new Date().toISOString(), who: mode }, o)));
  let lockedByDry = false;
  const lock = (why) => { log({ ev: "lock", why, dry }); if (dry) { lockedByDry = dry !== "fail"; return; } if (bindLock()) $.SACLockScreenImmediate(); };
  const pmset = () => { log({ ev: "pmset", dry }); if (!dry) $.NSTask.launchedTaskWithLaunchPathArguments("/usr/bin/pmset", $(["displaysleepnow"])); };
  const locked = () => lockedByDry || (!dry && sessionLocked());

  if (mode === "warden") {
    const holder = Number(argv[2]);
    write(path("warden.json"), JSON.stringify({ pid: $.getpid() }));
    say({ ok: true, pid: $.getpid() });
    let s = wardenInit({ max: Number(argv[3]) }), n = 0, beat = now();
    for (;;) {
      // Whether the holder lives, every tick; its beat and the lock every third,
      // and its exit note as soon as it's gone.
      const holderAlive = alive(holder), slow = n++ % 3 === 0 || !holderAlive || s.phase === "locking";
      if (slow) beat = Number(read(path("beat")) || beat);
      const ex = holderAlive ? "" : read(path("exit.json"));
      const r = { t: now(), holderAlive, beatAge: now() - beat, exitReason: ex ? JSON.parse(ex).why : null, locked: slow ? locked() : false };
      const o = wardenStep(s, r); s = o.s;
      for (const a of o.act) {
        if (a.kind === "kill") { log({ ev: "kill", pid: holder }); $.kill(holder, 9); }
        else if (a.kind === "lock") lock(a.why);
        else if (a.kind === "pmset") pmset();
        else if (a.kind === "exit") { log({ ev: "exit", why: a.why }); $.exit(0); }
      }
      delay(K.TICK);
    }
  }

  if (mode !== "holder") { say({ ok: false, code: "usage", error: "veil.js holder|warden|selftest" }); $.exit(2); }
  const owner = Number(argv[2]);
  $.NSApplication.sharedApplication.setActivationPolicy(1);
  const level = Number($.CGShieldingWindowLevel()) + 1;
  const wins = {};
  // A real veil takes the keyboard: veil comes to the front and a cover is the
  // key window, so the first key lands on it rather than the user's app, and
  // locks. A dry run takes it only when asked, since the user may be here.
  const takeKeys = !dry || env.VEIL_TAKE_KEYS === "1";
  ObjC.registerSubclass({ name: "VeilPanel", superclass: "NSPanel", methods: { canBecomeKeyWindow: { types: ["bool", []], implementation: () => takeKeys } } });
  function keys() {
    if (!takeKeys || $.NSApp.isActive) return;
    $.NSApp.activateIgnoringOtherApps(true);
    const first = wins[Object.keys(wins)[0]];
    if (first) first.w.makeKeyAndOrderFront($());
  }
  function cover() {
    const main = $.CGDisplayBounds($.CGMainDisplayID());
    for (const d of screens()) {
      if (d.loft || d.mirrorOf || wins[d.id]) continue;
      const b = $.CGDisplayBounds(d.id);
      const rect = $.NSMakeRect(b.origin.x, main.size.height - (b.origin.y + b.size.height), b.size.width, b.size.height);
      // Borderless (0); non-activating (1 << 7) unless veil takes the keyboard.
      const w = $.VeilPanel.alloc.initWithContentRectStyleMaskBackingDefer(rect, takeKeys ? 0 : 1 << 7, 2, false);
      w.level = level; w.backgroundColor = $.NSColor.blackColor; w.opaque = false; w.alphaValue = ALPHA;
      w.hasShadow = false; w.hidesOnDeactivate = false; w.releasedWhenClosed = false;
      // Every Space (1), stationary (16), out of the window cycle (64), beside full-screen apps (256).
      w.collectionBehavior = 1 | 16 | 64 | 256;
      w.setFrameDisplay(rect, true); w.orderFrontRegardless;
      wins[d.id] = { w, num: Number(w.windowNumber), b: { x: b.origin.x, y: b.origin.y, w: b.size.width, h: b.size.height } };
    }
  }
  // Why the cover falls short, or "": each window on screen at its level,
  // opaque enough, and spanning its display.
  function coverFault() {
    const ids = Object.keys(wins);
    if (!ids.length) return "no display to cover";
    for (const id of ids) {
      // Only this window (kCGWindowListOptionIncludingWindow), if it's on screen.
      const c = wins[id], e = (ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(8, c.num))) || []).find((x) => x.kCGWindowNumber === c.num && x.kCGWindowIsOnscreen), live = $.CGDisplayBounds(Number(id)), b = e && e.kCGWindowBounds;
      if (!e) return `display ${id}: its cover isn't on screen`;
      if (e.kCGWindowLayer !== level || e.kCGWindowAlpha < ALPHA - 0.0005) return `display ${id}: its cover is at level ${e.kCGWindowLayer}, alpha ${e.kCGWindowAlpha}`;
      if (b.X > live.origin.x || b.Y > live.origin.y || b.X + b.Width < live.origin.x + live.size.width || b.Y + b.Height < live.origin.y + live.size.height) return `display ${id}: its cover doesn't span it`;
    }
    return "";
  }
  const coverOk = () => !coverFault();
  function close() { for (const id of Object.keys(wins)) wins[id].w.close; }

  cover();
  // WindowServer lists a new window a moment after it's ordered front.
  let ok = false;
  for (let i = 0; i < 20 && !ok; i++) { spin(K.TICK); ok = coverOk(); }
  if (!ok) { const why = coverFault(); close(); say({ ok: false, code: "cover_failed", error: `veil couldn't cover every display (${why}); nothing was locked` }); $.exit(1); }
  say({ ok: true, pid: $.getpid(), covered: Object.keys(wins).map(Number) });
  let s = holderInit({ max: Number(argv[3]), dry }), n = 0, r = null, warden = 0;
  for (;;) {
    spin(K.TICK);
    // Input every tick, since it's the cheapest read and the first touch matters
    // most; the rest every third tick (every tick while a lock is pending), and
    // the cover every fifth.
    if (n % 5 === 0) ok = coverOk();
    if (n++ % 3 === 0 || !r || s.phase === "locking") {
      write(path("beat"), String(now()));
      keys();
      if (!warden) { const wj = read(path("warden.json")); warden = wj ? JSON.parse(wj).pid : 0; }
      r = { displays: screens(), covered: Object.keys(wins).map(Number), locked: locked() };
    }
    // The cheap triggers every tick: input, `veil down`, and both processes.
    r = Object.assign({}, r, { t: now(), idle: idle(), coverOk: ok, down: exists(path("down")), ownerAlive: !owner || alive(owner), wardenAlive: warden ? alive(warden) : null });
    const o = holderStep(s, r); s = o.s;
    for (const a of o.act) {
      if (a.kind === "lock") lock(a.why);
      else if (a.kind === "pmset") pmset();
      else if (a.kind === "would_lock") log({ ev: "would_lock", why: a.why, idle: a.idle });
      else if (a.kind === "close") close();
      else if (a.kind === "exit") { write(path("exit.json"), JSON.stringify({ why: a.why })); log({ ev: "exit", why: a.why }); $.exit(0); }
    }
  }
}

function say(o) { $.NSFileHandle.fileHandleWithStandardOutput.writeData($(JSON.stringify(o) + "\n").dataUsingEncoding($.NSUTF8StringEncoding)); }
function read(p) { const s = $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null); return s.isNil() ? "" : ObjC.unwrap(s); }
function write(p, text) { $(text).writeToFileAtomicallyEncodingError(p, true, $.NSUTF8StringEncoding, null); }
function exists(p) { return $.NSFileManager.defaultManager.fileExistsAtPath(p); }
function append(p, line) {
  const fm = $.NSFileManager.defaultManager;
  if (!fm.fileExistsAtPath(p)) fm.createFileAtPathContentsAttributes(p, $(), $());
  const h = $.NSFileHandle.fileHandleForWritingAtPath(p);
  if (h.isNil()) return;
  h.seekToEndOfFile; h.writeData($(line + "\n").dataUsingEncoding($.NSUTF8StringEncoding)); h.closeFile;
}
// Waits by taking the app's events, so AppKit learns of display changes and
// clicks on the cover are absorbed.
function spin(seconds) {
  const until = $.NSDate.dateWithTimeIntervalSinceNow(seconds);
  for (;;) {
    const e = $.NSApp.nextEventMatchingMaskUntilDateInModeDequeue(0xffffffffffffffff, until, $.NSDefaultRunLoopMode, true);
    if (!e || e.isNil()) return;
    $.NSApp.sendEvent(e);
  }
}
// Seconds since the last real key, click, move or scroll from hardware (HID
// system state). Not the any-event counter: it also counts null events, which
// another process's first posted event and power assertions produce, so
// perch's background input would trip it. Event types: left, right and other
// mouse down (1, 3, 25), moved and dragged (5, 6, 7, 27), key down (10),
// modifier (12), scroll (22), tablet (23, 24).
const INPUT_TYPES = [1, 3, 25, 5, 6, 7, 27, 10, 12, 22, 23, 24];
function idle() { return Math.min.apply(null, INPUT_TYPES.map((t) => Number($.CGEventSourceSecondsSinceLastEventType(1, t)))); }
// Every active display; a loft is vendor 0x6c66, product 0x7466. The ids
// come back through a byte buffer, read as base64 (a Ref holds only one).
function displays() {
  const buf = $.NSMutableData.dataWithLength(4 * 32), cnt = $.NSMutableData.dataWithLength(4);
  if ($.CGGetActiveDisplayList(32, buf.mutableBytes, cnt.mutableBytes) !== 0) return [];
  const n = u32s(ObjC.unwrap(cnt.base64EncodedStringWithOptions(0)))[0];
  return u32s(ObjC.unwrap(buf.base64EncodedStringWithOptions(0))).slice(0, n).map((id) => ({
    id, loft: Number($.CGDisplayVendorNumber(id)) === 0x6c66 && Number($.CGDisplayModelNumber(id)) === 0x7466, mirrorOf: Number($.CGDisplayMirrorsDisplay(id)),
  }));
}
// Little-endian uint32s from base64.
function u32s(b64) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", bytes = [];
  for (let i = 0; i < b64.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => A.indexOf(b64[i + k]));
    const x = (v[0] << 18) | (v[1] << 12) | ((v[2] & 63) << 6) | (v[3] & 63);
    bytes.push((x >> 16) & 255); if (v[2] >= 0) bytes.push((x >> 8) & 255); if (v[3] >= 0) bytes.push(x & 255);
  }
  const out = [];
  for (let i = 0; i + 3 < bytes.length; i += 4) out.push((bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0);
  return out;
}
// IOConsoleUsers gains CGSSessionScreenIsLocked once the screen is locked.
function sessionLocked() {
  try {
    const users = ObjC.deepUnwrap($.IORegistryEntryCreateCFProperty($.IORegistryGetRootEntry(0), $("IOConsoleUsers"), $(), 0)) || [];
    return users.some((u) => !!u && u.CGSSessionScreenIsLocked === true);
  } catch (e) { return false; }
}
// macOS's own lock screen, the one the menu's Lock Screen shows (private
// login.framework); binding it doesn't call it.
function bindLock() {
  if (bindLock.ok !== undefined) return bindLock.ok;
  try {
    ObjC.bindFunction("dlopen", ["void *", ["char *", "int"]]);
    $.dlopen("/System/Library/PrivateFrameworks/login.framework/login", 2);
    ObjC.bindFunction("SACLockScreenImmediate", ["void", []]);
    bindLock.ok = true;
  } catch (e) { bindLock.ok = false; }
  return bindLock.ok;
}
