// Sample data for tests: the add-on's generic example person (Jordan Lee), never anyone real.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function tempDataDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ja-test-"));
  process.env.JA_DATA_DIR = d;
  // The mock AIs answer the same question differently on purpose; remembered answers would hide that.
  process.env.JA_NO_AI_CACHE = "1";
  return d;
}

export const exampleAnswers = () => ({
  firstName: "Jordan", lastName: "Lee", preferredName: "", email: "jordan.lee@example.com", phone: "+1 (512) 555-0142",
  linkedin: "https://www.linkedin.com/in/jordanlee-example", github: "https://github.com/jordanlee-example", website: "https://jordanlee.example.com",
  otherLinks: "", street: "100 Example St", city: "Austin", state: "Texas", zip: "78701", country: "United States",
  workAuthorized: "yes", needsSponsorship: "no", authCountry: "United States",
  education: [{ school: "University of Texas at Austin", degree: "B.S.", field: "Computer Science", start: "2018-08", end: "2022-05" }],
  years: [{ type: "Software engineering", years: 3 }, { type: "Python", years: 3 }, { type: "TypeScript", years: 2 }],
  totalYears: 4, currentEmployer: "Acme Health", currentTitle: "Software Engineer",
  noticePeriod: "2 weeks", startAvailability: "Two weeks after accepting an offer",
  relocation: "radius", travel: "some", over18: "yes", arbitration: "never", arbitrationCompanies: [], heardAbout: "Job board", salary: "",
  demographics: { gender: "decline", race: "decline", hispanic: "decline", veteran: "decline", disability: "decline", lgbtq: "decline" },
  cannotClaim: ["Rust"],
});

export const examplePrefs = () => ({
  titles: ["Software Engineer", "Backend Engineer"], keywords: ["APIs"], titleExclude: [],
  cities: [{ name: "Austin", region: "Texas", admin1: "TX", country: "US", lat: 30.267, lon: -97.743 }],
  radius: 25, radiusUnit: "mi", remote: true, remoteCountry: "US", seniority: ["junior", "middle"], internships: false,
  maxYearsRequired: 5, excludeCompanies: ["Initech"], excludeAgencies: true, postedWithinDays: 14, alreadyApplied: "",
  sources: ["greenhouse", "lever", "ashby"],
});

// The example profile with every piece approved, as the review screen would leave it.
export function approvedExample(Profile) {
  const p = JSON.parse(JSON.stringify(Profile.EXAMPLE));
  for (const k of ["summaries", "headers", "skills", "education", "bases"]) for (const x of p[k] || []) x.approved = true;
  for (const k of ["experience", "projects"]) for (const e of p[k]) for (const b of e.bullets) b.approved = true;
  return p;
}
