// "Update now", end to end, on an installed app: a local feed offers version
// 99.0.0 (the freshly built installer or zipped app, with its checksum). The app
// downloads it, checks it, quits, installs it and starts again.
//
//   JA_APP_EXE=<installed app> JA_UPDATE_FILE=<dist/...zip or .exe> node test/e2e/update.mjs
import assert from "node:assert";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";

const exe = process.env.JA_APP_EXE, file = process.env.JA_UPDATE_FILE;
assert.ok(exe && file, "set JA_APP_EXE and JA_UPDATE_FILE");
const name = path.basename(file);
const sum = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const server = http.createServer((req, res) => {
  const base = `http://127.0.0.1:${server.address().port}`;
  if (req.url === "/latest") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ tag_name: "v99.0.0", html_url: base + "/release", body: "Test release",
      assets: [{ name, size: fs.statSync(file).size, browser_download_url: base + "/file" }, { name: "SHA256SUMS.txt", browser_download_url: base + "/sums" }] }));
  }
  if (req.url === "/sums") { res.writeHead(200); return res.end(`${sum}  ${name}\n`); }
  if (req.url === "/file") { res.writeHead(200, { "content-length": fs.statSync(file).size }); return fs.createReadStream(file).pipe(res); }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));

const dataDir = process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support", "Job Autopilot") : path.join(process.env.APPDATA || "", "Job Autopilot");
const launches = () => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, "launches.json"), "utf8")); } catch { return []; } };

const app = await electron.launch({ executablePath: exe, args: [], env: { ...process.env, JA_UPDATE_FEED: `http://127.0.0.1:${server.address().port}/latest` }, timeout: 120000 });
const win = await app.firstWindow();
const api = (p, b) => win.evaluate(([p, b]) => window.ja.api(p, b), [p, b]);
const checked = await api("/api/update/check", {});
console.log("check:", checked.phase, checked.info && checked.info.latest, "packaged:", checked.packaged);
assert.strictEqual(checked.phase, "available");
const before = launches().length;
const bundleOf = () => path.resolve(exe, "..", "..", "..");
const inodeBefore = process.platform === "darwin" ? fs.statSync(bundleOf()).ino : null;
const t0 = Date.now();
const started = await api("/api/update/install", {});
assert.ok(!started.error, started.error);
let last = "";
const closed = new Promise((r) => app.on("close", r));
const poll = (async () => {
  for (;;) {
    const u = await api("/api/update").catch(() => null);
    if (!u) break;
    const line = `${u.phase} ${Math.round((u.progress || 0) * 100)}% ${u.error || ""}`;
    if (line !== last) console.log("update:", (last = line));
    assert.notStrictEqual(u.phase, "error", u.error);
    await new Promise((r) => setTimeout(r, 500));
  }
})();
await Promise.race([closed, poll]);
await closed;
console.log(`the app quit to install, after ${Date.now() - t0} ms`);

// The new copy starts by itself and records its launch.
let relaunched = null;
for (let i = 0; i < 240 && !relaunched; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  relaunched = launches().slice(before).find((l) => Date.parse(l.at) > t0);
}
assert.ok(relaunched, "the app started again after installing");
console.log("relaunched:", JSON.stringify(relaunched));
if (process.platform === "darwin") {
  const bundle = path.resolve(exe, "..", "..", "..");
  assert.ok(!fs.existsSync(bundle + ".old-update"), "the old copy was removed");
  assert.notStrictEqual(fs.statSync(bundle).ino, inodeBefore, "the app bundle was replaced by the downloaded one");
  execSync(`codesign -v ${JSON.stringify(bundle)}`);
  execSync("pkill -f 'Job Autopilot.app/Contents/MacOS/Job Autopilot' || true");
} else {
  execSync('taskkill /IM "Job Autopilot.exe" /F /T || exit 0', { shell: "cmd.exe" });
}
server.close();
console.log("UPDATE PASS");
