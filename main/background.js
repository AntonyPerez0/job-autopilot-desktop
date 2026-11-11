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
    if (w.finish && w.finish.phase === "yours") return `Your turn: ${w.finish.company}`;
    if (w.finish && w.finish.phase === "filling") return `Filling in ${w.finish.company} for you to finish`;
    if (s.paused) return "Paused";
    if (w.trouble && /^waiting: /.test(w.now || "")) return { internet: "Waiting: no internet", ai: "Waiting: the AI isn't working", browser: "Waiting: no browser to apply with", resume: "Waiting: your resume has a problem", disk: "Waiting: the disk is full" }[w.trouble.kind] || "Waiting";
    if (w.job && w.job.practice) return `Practicing on ${w.job.company}: nothing is sent`;
    if (w.job) return `Applying to ${w.job.company}`;
    if (w.now === "searching") return "Looking for new jobs";
    if (s.dryRun && !s.reviewedDryRun && st.firstFilled) return "Waiting for you to check the practice application";
    if (s.dryRun) return `Practice mode: nothing is sent${st.practice && st.practice.count ? ` (${st.practice.count} to check)` : ""}`;
    if (/cap/.test(w.now)) return `Done for today: ${st.appliedToday} sent`;
    return `${st.appliedToday} sent today`;
  };
  const menu = (st) => Menu.buildFromTemplate([
    { label: doing(st), enabled: false },
    { type: "separator" },
    { label: "Open Job Autopilot", click: show },
    { label: st.settings.paused ? "Continue" : "Pause", click: () => core.api.handle("/api/settings", { paused: !st.settings.paused }) },
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
    // Finish with me: the browser window is waiting for them.
    const f = st.state && st.state.finish;
    if (f && f.phase === "yours") out.push({ key: `finish:${f.slug}:${f.since}`, title: `Your turn: ${f.company}`, body: String(f.why || "").replace(/^./, (c) => c.toUpperCase()), target: { job: f.slug } });
    // Practice applications waiting to be looked at: the app fills in no more until then.
    const pr = st.practice;
    if (st.settings.dryRun && st.settings.reviewedDryRun && pr && pr.held && pr.first) out.push({ key: `practice-wait:${pr.first.slug}`, title: "Your practice applications are waiting", body: `${pr.unchecked} new ones are filled in. The app fills in no more until you open one, and nothing is sent until you start sending.`, target: { view: "filled" } });
    const ai = st.search && st.search.aiProblem;
    if (ai) out.push({ key: `ai:${ai}`, title: "The AI stopped working", body: ai, target: { view: "settings" } });
    // What keeps every application from being tried and needs the person (no internet sorts itself out).
    const tr = st.state && st.state.trouble;
    if (tr && tr.kind !== "internet" && !(tr.kind === "ai" && ai)) out.push({ key: `trouble:${tr.text}`, title: "Job Autopilot can't apply right now", body: tr.text, target: tr.kind === "ai" ? { view: "settings" } : { view: "overview" } });
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
    // Queued jobs that are waiting (a referral, a few days between applications to one company) aren't work for today.
    // In practice mode, practice applications count toward the day, and the app waits while they wait for the person.
    const today = st.appliedToday + (s.dryRun ? st.practicedToday || 0 : 0);
    const waiting = s.dryRun && ((!s.reviewedDryRun && st.firstFilled) || (st.practice && st.practice.held));
    const work = !s.paused && (!!st.state.job || st.state.now === "searching" || ((c.queued || 0) > 0 && !!st.next && today < s.dailyCap && !waiting));
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
