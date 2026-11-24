# veil

veil covers your Mac's screens and locks it the moment anyone touches it, so you can leave it unlocked for an agent to keep working. The agent's background work in your browser keeps going under the cover; when its task ends, the Mac locks.

## Install
```bash
git clone https://github.com/sryo/veil ~/.veil && cd ~/.veil && npm link
```

## Use
```bash
veil up             # cover every screen; once you stop typing, the first touch locks the Mac
veil up --owner 123 # also lock when process 123 (the agent's task) ends
veil up --max 60    # lock after 60 minutes at the latest (the default is 120)
veil status         # whether a veil is up, and since when
veil down           # lock the Mac now
```

An agent you tell "I'm leaving" can run `veil up --owner <its pid>` itself.

## What it never does
- It never unlocks your Mac. You come back to macOS's own lock screen and your password or Touch ID, as always.
- It never changes your login settings or installs anything that runs as administrator.
- It never stays on your screen after the Mac locks, or when a lock doesn't take.

## Known gaps
- veil comes to the front while it's up, so a key, click or mouse move only reaches the cover.
- If the agent brings a window to the front or moves the real pointer, that counts as a touch and locks the Mac. perch's background clicks and presses don't.

## Works with
- [perch](https://github.com/sryo/perch): your agent keeps driving your browser under the veil.
- [loft](https://github.com/sryo/loft): windows on a loft aren't covered; nobody sees them anyway.
- `caffeinate`: veil keeps the screen awake while it's up, so it doesn't need it, but works beside it.
