// "Update now": download the new version, wait for the application in progress
// to finish, then swap the app and restart it.
// - macOS: the new .app comes zipped. A small script waits for this app to quit,
//   moves the new .app into place and opens it. (Apple's own updater needs a paid
//   Developer ID signature, which these builds do not have yet.)
// - Windows: the new installer runs silently over this install and starts the app.
import { app } from "electron";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkForUpdate, download } from "../core/update.js";

const state = { phase: "idle", progress: 0, info: null, error: null, checkedAt: null };
export const updateState = () => ({ ...state, packaged: app.isPackaged });

let worker = null;
export function initUpdater(w) {
  worker = w;
  const check = () => checkNow().catch(() => {});
  setTimeout(check, 10000);
  setInterval(check, 6 * 3600 * 1000).unref();
}

export async function checkNow() {
  if (["downloading", "waiting", "installing"].includes(state.phase)) return updateState();
  state.phase = "checking"; state.error = null;
  try {
    state.info = await checkForUpdate(app.getVersion());
    state.phase = state.info.newer ? "available" : "uptodate";
  } catch (e) { state.phase = "error"; state.error = "Could not check for updates: " + e.message; }
  state.checkedAt = Date.now();
  return updateState();
}

// The .app bundle this copy runs from, and whether it can be replaced.
function macBundle() {
  const bundle = path.resolve(process.execPath, "..", "..", "..");
  if (!bundle.endsWith(".app")) throw new Error("Could not find the app bundle.");
  if (/AppTranslocation|^\/Volumes\//.test(bundle)) {
    throw new Error("The app is running from the download or the disk image. Drag Job Autopilot into Applications, open it from there, then update.");
  }
  try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); fs.accessSync(bundle, fs.constants.W_OK); }
  catch { throw new Error(`This macOS account cannot replace ${bundle}. Download the new version from the releases page instead.`); }
  return bundle;
}

export async function installNow() {
  if (!app.isPackaged) throw new Error("Updates install only in the installed app.");
  if (!state.info || !state.info.newer) await checkNow();
  if (!state.info || !state.info.newer) throw new Error("You already have the latest version.");
  if (["downloading", "waiting", "installing"].includes(state.phase)) return updateState();
  const bundle = process.platform === "darwin" ? macBundle() : null;
  run(bundle).catch((e) => { state.phase = "error"; state.error = e.message; if (worker) worker.hold(false); });
  return updateState();
}

async function run(bundle) {
  state.phase = "downloading"; state.progress = 0; state.error = null;
  const dir = path.join(app.getPath("userData"), "updates");
  fs.rmSync(dir, { recursive: true, force: true });
  const file = await download(state.info, dir, (p) => { state.progress = p; });

  // Never restart in the middle of an application: let the one in progress finish first.
  state.phase = "waiting";
  worker.hold(true);
  for (let i = 0; i < 30 * 60 && worker.state.job; i++) await new Promise((r) => setTimeout(r, 1000));
  if (worker.state.job) throw new Error("An application is still in progress after 30 minutes; try again later.");
  state.phase = "installing";
  worker.stop();
  const { closeBrowser } = await import("../core/browser.js");
  await Promise.race([closeBrowser(), new Promise((r) => setTimeout(r, 5000))]);

  if (process.platform === "darwin") {
    const unpacked = path.join(dir, "new");
    execFileSync("/usr/bin/ditto", ["-x", "-k", file, unpacked]);
    const next = fs.readdirSync(unpacked).find((n) => n.endsWith(".app"));
    if (!next) throw new Error("The update did not contain the app.");
    const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
    const script = `PID=${process.pid}; APP=${q(bundle)}; NEW=${q(path.join(unpacked, next))}; OLD="$APP.old-update"
for i in $(seq 1 240); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
rm -rf "$OLD"
if mv "$APP" "$OLD" && mv "$NEW" "$APP"; then rm -rf "$OLD"; elif [ -d "$OLD" ] && [ ! -d "$APP" ]; then mv "$OLD" "$APP"; fi
xattr -dr com.apple.quarantine "$APP" 2>/dev/null
open "$APP"`;
    spawn("/bin/sh", ["-c", script], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "win32") {
    // The same switches electron-updater uses: silent, as an update, and start the app afterwards.
    spawn(file, ["/S", "--updated", "--force-run"], { detached: true, stdio: "ignore" }).unref();
  } else throw new Error("Automatic updates are for macOS and Windows.");
  setTimeout(() => app.exit(0), 500);
}
