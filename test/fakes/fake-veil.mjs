// Stands in for `osascript -l JavaScript veil.js holder|warden HOME ...`.
// FAKE_VEIL: "ok" (default), "fail" (the holder answers ok:false), "mute"
// (no answer). Once up it stays alive until killed; the holder ends like
// veil.js when HOME/down appears, writing HOME/exit.json.
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const [mode, home, a2] = process.argv.slice(2);
const how = process.env.FAKE_VEIL || "ok";
const say = (o) => process.stdout.write(JSON.stringify(o) + "\n");
if (mode === "holder") {
  if (how === "fail") { say({ ok: false, code: "cover_failed", error: "a display could not be covered" }); process.exit(1); }
  if (how === "ok") say({ ok: true, pid: process.pid, covered: [1] });
  setInterval(() => {
    if (existsSync(join(home, "down"))) { writeFileSync(join(home, "exit.json"), JSON.stringify({ why: process.env.FAKE_EXIT || "locked" })); process.exit(0); }
  }, 20);
} else {
  if (how !== "mute") { writeFileSync(join(home, "warden.json"), JSON.stringify({ pid: process.pid })); say({ ok: true, pid: process.pid }); }
  setInterval(() => { try { process.kill(Number(a2), 0); } catch { process.exit(0); } }, 20);
}
