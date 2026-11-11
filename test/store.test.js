// The person's own files (settings, what to look for, answers, resume): a file that can't be read after a crash or a
// power cut falls back to the copy from the save before, never to a blank start.
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { tempDataDir } from "./helpers.js";

tempDataDir();
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const file = (n) => path.join(process.env.JA_DATA_DIR, n);

test("a settings file that can't be read: the copy from the save before is used, and the next save puts it right", () => {
  store.saveSettings({ onboarded: true, dryRun: false, dailyCap: 7 });
  store.saveSettings({ dailyCap: 8 });
  fs.writeFileSync(file("settings.json"), "\0\0\0\0"); // what a power cut can leave
  const s = store.getSettings();
  assert.strictEqual(s.onboarded, true, "not the setup all over again");
  assert.strictEqual(s.dryRun, false);
  assert.strictEqual(s.dailyCap, 7, "one save behind");
  store.saveSettings({ dailyCap: 9 });
  assert.deepStrictEqual([store.getSettings().onboarded, store.getSettings().dailyCap], [true, 9]);
  assert.strictEqual(JSON.parse(fs.readFileSync(file("settings.json"), "utf8")).dailyCap, 9);
});

test("the resume and the answers are kept the same way; a file never written is still a fresh start", () => {
  assert.strictEqual(store.getProfile(), null);
  store.saveProfile({ name: "Jordan Lee", experience: [] });
  store.saveProfile({ name: "Jordan Lee", experience: [{ id: "e1" }] });
  fs.writeFileSync(file("profile.json"), "{ half a fi");
  assert.strictEqual(store.getProfile().name, "Jordan Lee");
  store.saveAnswers({ firstName: "Jordan" }); store.saveAnswers({ lastName: "Lee" });
  fs.truncateSync(file("answers.json"), 0);
  assert.strictEqual(store.getAnswers().firstName, "Jordan");
  // Other files (a chat, a cache) have no earlier copy kept.
  store.writeJSON("talk.json", { turns: [1] }); store.writeJSON("talk.json", { turns: [1, 2] });
  assert.ok(!fs.existsSync(file("talk.json.bak")));
});
