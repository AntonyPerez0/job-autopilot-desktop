// Updates: version order, the right file for each computer, checksums enforced.
import test from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { checkForUpdate, download, newerVersion, parseSums, pickAsset } from "../core/update.js";

test("version order", () => {
  assert.ok(newerVersion("0.3.0", "0.2.0"));
  assert.ok(newerVersion("v1.0.0", "0.9.9"));
  assert.ok(!newerVersion("0.2.0", "0.2.0"));
  assert.ok(!newerVersion("0.1.9", "0.2.0"));
});

test("the right file for each computer", () => {
  const assets = [{ name: "Job-Autopilot-0.3.0-mac-universal.dmg" }, { name: "Job-Autopilot-0.3.0-mac-universal.zip" }, { name: "Job-Autopilot-Setup-0.3.0.exe" }, { name: "SHA256SUMS.txt" }];
  assert.strictEqual(pickAsset(assets, "darwin").name, "Job-Autopilot-0.3.0-mac-universal.zip");
  assert.strictEqual(pickAsset(assets, "win32").name, "Job-Autopilot-Setup-0.3.0.exe");
  assert.strictEqual(pickAsset(assets, "linux"), null);
  assert.deepStrictEqual(parseSums(`${"a".repeat(64)}  x.zip\n${"B".repeat(64)} *y.exe\njunk`), { "x.zip": "a".repeat(64), "y.exe": "b".repeat(64) });
});

test("a download that does not match its checksum is thrown away", async () => {
  const body = Buffer.from("the new app");
  const good = crypto.createHash("sha256").update(body).digest("hex");
  let sums = `${good}  Job-Autopilot-Setup-9.0.0.exe\n`;
  const s = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${s.address().port}`;
    if (req.url === "/latest") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ tag_name: "v9.0.0", assets: [
      { name: "Job-Autopilot-Setup-9.0.0.exe", browser_download_url: base + "/f" }, { name: "Job-Autopilot-9.0.0-mac-universal.zip", browser_download_url: base + "/f" },
      { name: "SHA256SUMS.txt", browser_download_url: base + "/s" }] })); }
    if (req.url === "/s") return res.end(sums);
    res.end(body);
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  process.env.JA_UPDATE_FEED = `http://127.0.0.1:${s.address().port}/latest`;
  try {
    const info = await checkForUpdate("0.2.0");
    assert.ok(info.newer);
    info.asset = { name: "Job-Autopilot-Setup-9.0.0.exe", url: `http://127.0.0.1:${s.address().port}/f` }; // this test machine may not be Mac or Windows
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ja-upd-"));
    const file = await download(info, dir);
    assert.strictEqual(fs.readFileSync(file, "utf8"), "the new app");
    sums = `${"0".repeat(64)}  Job-Autopilot-Setup-9.0.0.exe\n`;
    await assert.rejects(download(info, dir), /checksum/);
    assert.ok(!fs.existsSync(path.join(dir, "Job-Autopilot-Setup-9.0.0.exe.part")));
    await assert.rejects(download({ ...info, sumsUrl: null }, dir), /cannot be verified/);
  } finally { delete process.env.JA_UPDATE_FEED; s.close(); }
});
