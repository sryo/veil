# veil

How veil is built and how to work on it. Goals and how they are measured are in GOALS.md; fium rules in ~/Documents/fium/RULES.md.

This codebase is yours to shape: within a change, rework the structure rather than bolt onto it. Duplicates and bugs outside the change are named as the next change, not fixed in passing.

## Layout
```
veil.mjs          # the CLI: up, status, down; starts the holder, warden and caffeinate
veil.js           # JXA: the holder and the warden; pure decisions on top, glue in run()
test/             # node:test; the decisions under node:vm, the CLI against test/fakes
bench/run.mjs     # the fake world: every trigger and every way a lock ends
bench/live.mjs    # live, on a loft with the lock stubbed; --real locks once while the user is away
```

## How it works
- `veil up` spawns `veil.js holder` detached; it covers each physical display with a borderless non-activating NSPanel at `CGShieldingWindowLevel()+1`, alpha 0.999, checks the cover in CGWindowList and answers one JSON line. Then `veil.js warden` (holding the holder's pid) and `caffeinate -d -i -w <holder>`. The record is `$VEIL_HOME/veil.json` (default `~/Library/Application Support/veil`); `up.lock` (a directory) keeps ups one at a time.
- The holder ticks every 100ms (`spin`, so AppKit sees display changes and the cover absorbs clicks): HID idle (`CGEventSourceSecondsSinceLastEventType`, no permission), active displays (lofts, vendor `0x6c66`, skipped), the cover every fifth tick, the owner pid, the warden's pid, `$VEIL_HOME/down`, and whether the session is locked (IOConsoleUsers). It writes `beat` each tick. `holderStep` decides: arm after 2s idle; then a drop in the idle counter, or anytime the owner gone, `down`, a new display, the cover lost, the warden gone or the time limit, requests the lock.
- The lock is `SACLockScreenImmediate` (private login.framework, bound after `dlopen`, no permission), `pmset displaysleepnow` 1s later if it hasn't taken. Locked: the cover closes and both exit. Not locked within 3s: the cover closes anyway and the holder exits `lock_failed`. Nothing re-raises.
- The warden (`wardenStep`) locks when the holder dies or its beat is 1.5s stale (killing it first), or past the time limit plus 5s; it exits without locking when the holder left `exit.json` (a clean end).
- `VEIL_DRY=lock|fail|watch` stubs the lock (it takes, it never takes, or input is logged as `would_lock` and rearms); only then may `VEIL_DISPLAYS` limit the cover to named displays, which a dry run uses to cover a loft. A real veil always covers every physical display.

## Rules
- Never unlock, never touch the authorization database or login policy, never install a root component; `test/contract.test.mjs` greps for it.
- Never set `canBecomeVisibleWithoutLogin`: at the lock screen the cover must be gone, so the user can always type their password.
- The cover stays below alpha 1: an opaque one makes pages under it hidden and perch's trusted clicks refuse.
- Until the Mac locks, a failure locks; after a lock, or a lock that can't be made, veil leaves nothing on screen.
- Never take the user's foreground or move the cursor: the cover is non-activating and the holder is an accessory app.
- Single-file CLI plus the JXA file, Node built-ins only, no build step.

## Test
```bash
npm test
```
A change is done when `fium done` says so: it measures every How we know row in GOALS.md where the change started and now.

## Live checks
- `node bench/live.mjs` covers only a loft perch makes and opens a Safari tab there on a 127.0.0.1 page; the lock is stubbed, so it runs while the user is here.
- `--real` locks the Mac once, and only while `fium away` says the user is away.
