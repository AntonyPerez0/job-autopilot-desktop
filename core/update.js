// Updates from GitHub Releases: find a newer version, pick the file for this
// computer, download it and check it against the release's SHA256SUMS.txt.
// Installing it (swapping the app and restarting) is main/updater.js.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPO = "AntonyPerez0/job-autopilot-desktop";
const FEED = `https://api.github.com/repos/${REPO}/releases/latest`;

// GitHub's API allows 60 unauthenticated requests an hour per network address, which a shared
// office or school network can use up. The releases page itself has no such limit: it redirects
// to the latest tag, and the file names follow from the version.
async function latestFromPage() {
  const res = await fetch(`https://github.com/${REPO}/releases/latest`, { redirect: "follow", signal: AbortSignal.timeout(15000) });
  const tag = (res.url.match(/\/releases\/tag\/(v[^/?#]+)/) || [])[1];
  if (!res.ok || !tag) throw new Error(`releases page: ${res.status}`);
  const v = tag.replace(/^v/, "");
  const dl = (name) => ({ name, browser_download_url: `https://github.com/${REPO}/releases/download/${tag}/${name}` });
  return { tag_name: tag, html_url: res.url, body: "", assets: [dl(`Job-Autopilot-${v}-mac-universal.zip`), dl(`Job-Autopilot-Setup-${v}.exe`), dl("SHA256SUMS.txt")] };
}

export function newerVersion(a, b) {
  const x = String(a).replace(/^v/, "").split(/[.-]/).map(Number), y = String(b).replace(/^v/, "").split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

// The file that updates this kind of computer: the zipped app on macOS, the installer on Windows.
export function pickAsset(assets, platform = process.platform) {
  const list = assets || [];
  if (platform === "darwin") return list.find((a) => /-mac-universal\.zip$/i.test(a.name)) || null;
  if (platform === "win32") return list.find((a) => /^Job-Autopilot-Setup-.*\.exe$/i.test(a.name)) || null;
  return null;
}

// "3b4f...  Job-Autopilot-Setup-0.3.0.exe" lines -> { name: hash }
export function parseSums(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m) out[m[2].trim()] = m[1].toLowerCase();
  }
  return out;
}

export async function checkForUpdate(current) {
  // JA_UPDATE_FEED points the updater at a test feed (the installer tests use one).
  let r;
  const res = await fetch(process.env.JA_UPDATE_FEED || FEED, { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(15000) }).catch((e) => ({ ok: false, status: e.message }));
  if (res.ok) r = await res.json();
  else if (!process.env.JA_UPDATE_FEED) r = await latestFromPage();
  else throw new Error(`update check: ${res.status}`);
  const latest = String(r.tag_name || "").replace(/^v/, "");
  const asset = pickAsset(r.assets);
  const sums = (r.assets || []).find((a) => a.name === "SHA256SUMS.txt");
  return { current, latest, newer: newerVersion(latest, current), url: r.html_url, notes: String(r.body || "").slice(0, 2000),
    asset: asset && { name: asset.name, url: asset.browser_download_url, size: asset.size }, sumsUrl: sums && sums.browser_download_url };
}

export async function download(info, dir, onProgress = () => {}) {
  if (!info.asset) throw new Error("This release has no update file for this computer.");
  if (!info.sumsUrl) throw new Error("This release has no checksums, so the update cannot be verified.");
  const sums = parseSums(await (await fetch(info.sumsUrl, { signal: AbortSignal.timeout(30000) })).text());
  const want = sums[info.asset.name];
  if (!want) throw new Error(`No checksum for ${info.asset.name}.`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, info.asset.name);
  const res = await fetch(info.asset.url, { signal: AbortSignal.timeout(30 * 60000) });
  if (!res.ok || !res.body) throw new Error(`download: ${res.status}`);
  const total = Number(res.headers.get("content-length")) || info.asset.size || 0;
  const hash = crypto.createHash("sha256");
  const out = fs.createWriteStream(file + ".part");
  let got = 0;
  for await (const chunk of res.body) {
    hash.update(chunk);
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    onProgress(total ? got / total : 0);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  if (hash.digest("hex") !== want) { fs.rmSync(file + ".part", { force: true }); throw new Error("The download did not match its checksum, so it was thrown away. Try again."); }
  fs.renameSync(file + ".part", file);
  return file;
}
