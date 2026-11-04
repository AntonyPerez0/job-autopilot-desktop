// Keeping the autopilot working when its window is closed, for people who close windows without a second thought:
// an icon in the menu bar (macOS) or system tray (Windows) with what it's doing, Pause and Quit; starting with
// the computer if the person wants; keeping the computer awake while there are applications to send today; and a
// desktop notification when something needs them. Every ten seconds, from the same status the window shows.
import { app, Menu, Notification, Tray, nativeImage, powerSaveBlocker } from "electron";
import path from "node:path";

// core: { api, store }; show(): brings the window back; open(target): shows it on a page or a job; visible(): whether
// the person is looking at the window right now.
export function startBackground({ core, here, show, open, visible }) {
  let tray = null, blocker = null, seen = null, login = null;
  // Linux (not a supported platform, but the tests run there) needs a display for a tray icon; without one, the window
  // comes back by opening the app again.
  const canTray = process.platform !== "linux" || !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY) && !process.argv.includes("--ozone-platform=headless");
  const image = () => {
    const size = process.platform === "darwin" ? 18 : 16;
    return nativeImage.createFromPath(path.join(here, "tray.png")).resize({ width: size, height: size });
  };
  const doing = (st) => {
    const s = st.settings, w = st.state;
    if (s.paused) return "Paused";
    if (w.job) return `Applying to ${w.job.company}`;
    if (w.now === "searching") return "Looking for new jobs";
    if (s.dryRun && !s.reviewedDryRun && st.firstFilled) return "Waiting for you to check the practice application";
    if (/cap/.test(w.now)) return `Done for today: ${st.appliedToday} sent`;
    return s.dryRun ? "Practice mode: nothing is sent" : `${st.appliedToday} sent today`;
  };
  const menu = (st) => Menu.buildFromTemplate([
    { label: doing(st), enabled: false },
    { type: "separator" },
    { label: "Open Job Autopilot", click: show },
    { label: st.settings.paused ? "Resume" : "Pause", click: () => core.api.handle("/api/settings", { paused: !st.settings.paused }) },
    { type: "separator" },
    { label: "Quit Job Autopilot", click: () => app.quit() },
  ]);

  // What deserves a notification: one each, the first time it shows up.
  const news = (st) => {
    const out = [];
    const r = st.replies || {};
    if (r.act && r.first) out.push({ key: `reply:${r.first.slug}:${r.first.at}`, title: `${r.first.company} wrote back`, body: r.first.subject, target: { job: r.first.slug } });
    const a = st.toAnswer || {};
    if (a.count && a.first) out.push({ key: `ask:${a.first.slug}`, title: "An application needs your answer", body: `${a.first.title} at ${a.first.company}: a question only you can answer.`, target: { job: a.first.slug } });
    if (st.settings.dryRun && !st.settings.reviewedDryRun && st.firstFilled) out.push({ key: `practice:${st.firstFilled.slug}`, title: "Your practice application is ready", body: `Check what it would send to ${st.firstFilled.company}, then start sending for real.`, target: { job: st.firstFilled.slug } });
    const ai = st.search && st.search.aiProblem;
    if (ai) out.push({ key: `ai:${ai}`, title: "The AI stopped working", body: ai, target: { view: "settings" } });
    return out;
  };

  async function tick() {
    const s = core.store.getSettings();
    if (!s.onboarded) return;
    let st;
    try { st = await core.api.handle("/api/status"); } catch { return; }
    if (!st || st.error) return;
    if (s.keepRunning !== false && canTray) {
      if (!tray) { tray = new Tray(image()); tray.setToolTip("Job Autopilot"); tray.on("click", show); }
      tray.setContextMenu(menu(st));
    } else if (tray) { tray.destroy(); tray = null; }
    // Only the installed app registers itself; a copy run from source would register Electron instead.
    if (app.isPackaged && login !== !!s.openAtLogin) {
      login = !!s.openAtLogin;
      try { app.setLoginItemSettings({ openAtLogin: login, openAsHidden: true, args: ["--hidden"] }); } catch { /* not allowed here */ }
    }
    const c = st.counts || {};
    const work = !s.paused && (!!st.state.job || st.state.now === "searching" || ((c.queued || 0) > 0 && st.appliedToday < s.dailyCap && !(s.dryRun && !s.reviewedDryRun && st.firstFilled)));
    if (s.keepAwake !== false && work) { if (blocker === null) blocker = powerSaveBlocker.start("prevent-app-suspension"); }
    else if (blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; }
    const items = news(st);
    // What was already there when the app started isn't news.
    if (seen === null) { seen = new Set(items.map((x) => x.key)); return; }
    for (const x of items) {
      if (seen.has(x.key)) continue;
      seen.add(x.key);
      if (s.notifications === false || visible() || !Notification.isSupported()) continue;
      const n = new Notification({ title: x.title, body: String(x.body || "").slice(0, 200) });
      n.on("click", () => open(x.target));
      n.show();
    }
  }
  const timer = setInterval(() => { tick().catch(() => {}); }, 10000);
  tick().catch(() => {});
  return {
    // The first time the window is closed into the background, say where it went.
    hidden() {
      const s = core.store.getSettings();
      if ((s.dismissed || []).includes("hide-notice") || !Notification.isSupported()) return;
      core.store.saveSettings({ dismissed: [...(s.dismissed || []), "hide-notice"] });
      new Notification({ title: "Job Autopilot is still working", body: `It keeps looking for jobs and applying. Open it from the ${process.platform === "darwin" ? "menu bar at the top of the screen" : "system tray, next to the clock"}, or choose Quit there.` }).show();
    },
    refresh: () => tick().catch(() => {}),
    stop() { clearInterval(timer); if (tray) tray.destroy(); if (blocker !== null) powerSaveBlocker.stop(blocker); },
  };
}
