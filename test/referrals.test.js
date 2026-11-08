// People the person knows, from LinkedIn's Connections.csv: who works where, matched to the employers of their jobs,
// with a short message asking for a referral for them to send themselves.
import test from "node:test";
import assert from "node:assert";
import { tempDataDir } from "./helpers.js";

tempDataDir();
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const R = await import("../core/referrals.js");

// LinkedIn's export: notes first, then the header row, quoted fields with commas and doubled quotes, CRLF lines.
const CSV = `\uFEFFNotes:\r\n"When exporting your connection data, you may notice that some of the email addresses are missing."\r\n\r\n` +
  `First Name,Last Name,URL,Email Address,Company,Position,Connected On\r\n` +
  `Sam,Rivera,https://www.linkedin.com/in/sam-rivera-example,,"Globex, Inc.",Engineering Manager,01 Feb 2025\r\n` +
  `Alex,"O""Neil",https://www.linkedin.com/in/alex-example,,Meta Platforms,"Recruiter, ""Tech""",03 Mar 2024\r\n` +
  `Robin,Lee,javascript:alert(1),,Metal Works Co,Welder,04 Apr 2024\r\n` +
  `,,,,,,\r\n` +
  `Kim,Park,https://www.linkedin.com/in/kim-example,,,Student,05 May 2024`;

test("Connections.csv: the header after LinkedIn's notes, quotes and commas inside fields, only real LinkedIn links", () => {
  const list = R.parseConnections(CSV);
  assert.deepStrictEqual(list.map((p) => [p.first, p.last, p.company, p.position]), [
    ["Sam", "Rivera", "Globex, Inc.", "Engineering Manager"],
    ["Alex", "O\"Neil", "Meta Platforms", "Recruiter, \"Tech\""],
    ["Robin", "Lee", "Metal Works Co", "Welder"],
  ], "rows without a name or a company are left out");
  assert.strictEqual(list[0].url, "https://www.linkedin.com/in/sam-rivera-example");
  assert.strictEqual(list[2].url, "", "never a link that isn't LinkedIn's");
  assert.throws(() => R.parseConnections("Name,Email\nSam,sam@example.com"), /isn't LinkedIn's Connections\.csv/);
});

test("the same employer: without its legal form, or one name the start of the other, never a different word", () => {
  assert.ok(R.sameEmployer("Globex, Inc.", "Globex"));
  assert.ok(R.sameEmployer("Meta", "Meta Platforms"));
  assert.ok(!R.sameEmployer("Meta", "Metal Works Co"));
  assert.ok(!R.sameEmployer("Globex", "Initech"));
  assert.ok(!R.sameEmployer("", "Globex"));
  assert.ok(!R.sameEmployer("AB", "AB Testing Co"), "a short name must match in full");
});

test("who they know at a company, kept on this computer, and a note in their name", () => {
  R.saveConnections(R.parseConnections(CSV));
  assert.deepStrictEqual(R.peopleAt("Meta").map((p) => p.first), ["Alex"]);
  assert.deepStrictEqual(R.peopleAt("Initech"), []);
  const note = R.referralNote({ first: "Sam" }, { title: "Support Engineer", company: "Globex", url: "https://globex.example/jobs/1" }, { firstName: "Jordan", lastName: "Lee" });
  assert.match(note, /^Hi Sam,/);
  assert.match(note, /Support Engineer role at Globex \(https:\/\/globex\.example\/jobs\/1\)/);
  assert.match(note, /Jordan Lee$/);
  R.clearConnections();
  assert.deepStrictEqual(R.loadConnections().people, []);
});
