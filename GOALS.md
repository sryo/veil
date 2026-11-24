# veil: goals

## What veil is for
You sometimes leave your Mac unlocked on purpose, with `caffeinate`, so an agent can keep driving your own signed-in apps (perch in your browser) while you're away. Nothing covers the screen or locks the Mac behind you. veil covers every screen and locks the Mac the moment someone touches it, or when the agent's task ends. It has to beat leaving the Mac bare (anyone walking by sees and uses everything), locking it yourself (the agent's background clicks and screenshots stop), and tools that also unlock the Mac without a password (a backdoor in the login policy).
- Someone who runs agents through perch on their own Mac; job: "step away for an hour while the agent works, and nobody can use or read my Mac"; starts with an unlocked Mac and a running agent; gives up when it locks them out, or when the agent stops working under it (guessed)
- The agent itself, told "I'm leaving"; job: put veil up tied to its own task; starts with its pid; gives up when `veil up` needs a permission it can't get (guessed)

## Never traded
- veil never unlocks anything, never changes the login policy or authorization database, never installs a root component.
- You are never locked out: the lock is macOS's own lock screen, and veil's cover is gone once the Mac is locked or a lock can't be made.
- Until the Mac locks, failing means locking: a veil that can't prove it covers every screen, or loses its partner process, locks the Mac.

## Goals, in priority order
When two goals conflict, the higher one wins.

1. **Never locks you out.** After a lock, and after a lock that didn't take, no veil window is left on any screen and nothing comes back after you unlock; a stalled veil is killed by its partner.
2. **Locks on the first touch.** Every physical screen is covered. A key, click or mouse move, the agent's task ending, a screen added, the cover failing, the time limit, or either veil process dying locks the Mac fast.
3. **Out of the agent's way.** Under the veil a page keeps painting at full rate, and perch's background clicks, presses and screenshots still land; the agent's own background input never trips it.
4. **Cheap.** Little memory and CPU while it waits; up in about a second.

## How we know
| Goal | Metric | Where | Run |
|---|---|---|---|
| 1 | veil windows left after a lock and after a failed one, re-raises after the lock, stalled holders the warden kills, warden locks after a clean exit (fake world) | `bench/run.mjs` | `node bench/run.mjs` |
| 2 | triggers that lock, out of every kind; ticks from trigger to lock request (fake world) | `bench/run.mjs` | `node bench/run.mjs` |
| 1 | on a loft with the lock stubbed: windows left after a lock, a failed lock, a stalled and a killed holder; seconds until a failed lock drops the cover; with the user away (`--real`), veil windows left on the real lock screen | `bench/live.mjs` | live: `node bench/live.mjs` |
| 2 | on a loft: seconds until the warden locks for a stalled and a killed holder | `bench/live.mjs` | live: `node bench/live.mjs` |
| 3 | on a loft under the veil: page visible, frames per second, trusted clicks and presses that hit, idle-counter resets from the agent's input, foreground app changes | `bench/live.mjs` | live: `node bench/live.mjs` |
| 4 | holder memory, CPU seconds per minute, `veil up` time | `bench/live.mjs` | live: `node bench/live.mjs` |

Caps: `all=ask quality=hard time=ask+10%`

## Non-goals
- Unlocking, or any way back in other than your password or Touch ID.
- Swallowing the first keystroke. It reaches the app in front before the lock lands; blocking it needs Accessibility or Input Monitoring and an input filter, a later change.
- Covering lofts. Nobody sees them.
- Watching a locked Mac. Once it's locked, macOS guards it and veil is gone.
