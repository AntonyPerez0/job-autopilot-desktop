"use strict";
// The profile: everything the add-on may put on a resume or into a form.
// The resume is only ever assembled from these approved pieces, by id.

(function (root) {
  const SCHEMA = "apply-helper/profile@1";

  const EXAMPLE = {
    schema: SCHEMA,
    name: "Jordan Lee",
    contact: {
      location: "Austin, TX", email: "jordan.lee@example.com", phone: "+1 (512) 555-0142",
      linkedin: "https://www.linkedin.com/in/jordanlee-example", github: "https://github.com/jordanlee-example",
      website: "https://jordanlee.example.com",
    },
    headers: [{ id: "citizen", text: "U.S. Citizen" }],
    summaries: [
      { id: "general", text: "Software engineer with three years building web applications in TypeScript and Python, most recently a scheduling product used by 40 clinics. Writes tests first, ships small changes often, and cares about clear APIs and docs." },
      { id: "backend", text: "Backend-leaning software engineer who has built REST APIs in Python and Node.js on PostgreSQL, with CI on GitHub Actions and containerized deploys. Three years at a healthcare startup, owning features from design to on-call." },
    ],
    experience: [
      {
        id: "acme", title: "Software Engineer", org: "Acme Health", location: "Austin, TX", dates: "Jun 2023 \u2013 Present", minBullets: 2,
        bullets: [
          { id: "scheduler", text: "Built the appointment scheduling service in Python and PostgreSQL that 40 clinics use to book patients." },
          { id: "ci", text: "Set up GitHub Actions CI with unit and integration tests, cutting failed deploys from weekly to rare." },
          { id: "api", text: "Designed the public REST API and its OpenAPI docs used by two partner integrations." },
          { id: "oncall", text: "Shared on-call for the scheduling service and wrote its runbooks." },
        ],
      },
      {
        id: "shop", title: "Web Developer (part-time)", org: "Corner Shop Co.", location: "Remote", dates: "Jan 2022 \u2013 May 2023", minBullets: 2,
        bullets: [
          { id: "store", text: "Built and maintained the online store on React and a small Express backend." },
          { id: "perf", text: "Cut page load time by half by compressing images and code-splitting the product pages." },
        ],
      },
    ],
    projects: [
      {
        id: "tracker", title: "Trail Tracker", link: "github.com/jordanlee-example/trail-tracker", url: "https://github.com/jordanlee-example/trail-tracker",
        bullets: [
          { id: "app", text: "A React Native app that records hikes offline and syncs when back online." },
          { id: "maps", text: "Rendered offline map tiles with a local cache and background prefetch." },
        ],
      },
      {
        id: "agentsite", title: "Recipe Box", link: "recipebox.example.com", url: "https://recipebox.example.com", aiBuilt: true, pinned: ["agents"],
        bullets: [
          { id: "agents", text: "Built with AI coding agents; I directed the work and reviewed each change, with tests gating every merge." },
          { id: "search", text: "Full-text recipe search on SQLite FTS5." },
        ],
      },
    ],
    skills: [
      { id: "lang", label: "Languages", items: "TypeScript, JavaScript, Python, SQL" },
      { id: "tools", label: "Frameworks & Tools", items: "React, Node.js, Express, PostgreSQL, Docker, GitHub Actions" },
    ],
    education: [{ school: "University of Texas at Austin", detail: "B.S., Computer Science", dates: "May 2022" }],
    bases: [
      {
        id: "swe", description: "General software engineering, experience first", header: null, summary: "general",
        skills: ["lang", "tools"],
        sections: [
          { kind: "experience", items: [{ id: "acme", bullets: ["scheduler", "ci", "api"] }, { id: "shop", bullets: ["store", "perf"] }] },
          { kind: "projects", items: [{ id: "tracker", bullets: ["app"] }] },
          { kind: "education" },
        ],
      },
    ],
    answers: [
      { label: "Full name", value: "Jordan Lee" }, { label: "First name", value: "Jordan" }, { label: "Last name", value: "Lee" },
      { label: "Email", value: "jordan.lee@example.com" }, { label: "Phone", value: "+1 (512) 555-0142" },
      { label: "LinkedIn", value: "https://www.linkedin.com/in/jordanlee-example" },
      { label: "GitHub", value: "https://github.com/jordanlee-example" }, { label: "Website", value: "https://jordanlee.example.com" },
      { label: "Location", value: "Austin, TX" }, { label: "Country", value: "United States" },
      { label: "Legally authorized to work in the US", value: "Yes" },
      { label: "Requires employer sponsorship now or in the future", value: "No" },
      { label: "Current or most recent employer", value: "Acme Health" },
      { label: "Current or most recent job title", value: "Software Engineer" },
    ],
    essaySample: "I like small teams where I can own a feature from the first sketch to the on-call pager. At Acme I built our scheduling service and I still get a kick out of seeing clinics use it every morning.",
    cannotClaim: ["Kubernetes", "AWS", "Java", "C++", "machine learning"],
    rules: {
      bannedWords: ["spearheaded", "leveraged", "utilized", "passionate", "synergy"],
      noEmDash: true,
      instructions: "Never invent metrics, skills or scope. Be honest about gaps.",
    },
  };

  const arr = (x) => (Array.isArray(x) ? x : []);

  function validate(p) {
    const errs = [];
    if (!p || typeof p !== "object") return ["Profile is not a JSON object."];
    if (!p.name) errs.push("name is missing.");
    const ids = (list, what) => {
      const seen = new Set();
      for (const x of arr(list)) {
        if (!x || !x.id) errs.push(`${what}: an entry has no id.`);
        else if (seen.has(x.id)) errs.push(`${what}: duplicate id "${x.id}".`);
        else seen.add(x.id);
      }
      return seen;
    };
    const sum = ids(p.summaries, "summaries");
    const sk = ids(p.skills, "skills");
    const hd = ids(p.headers, "headers");
    const exp = ids(p.experience, "experience");
    const pr = ids(p.projects, "projects");
    for (const e of arr(p.experience).concat(arr(p.projects))) ids(e.bullets, `bullets of "${e.id}"`);
    if (!sum.size) errs.push("Add at least one summary (approved text the resume may use).");
    if (!arr(p.bases).length) errs.push("Add at least one base resume layout under bases.");
    for (const b of arr(p.bases)) {
      if (b.summary && !sum.has(b.summary)) errs.push(`base "${b.id}": unknown summary "${b.summary}".`);
      if (b.header && !hd.has(b.header)) errs.push(`base "${b.id}": unknown header "${b.header}".`);
      for (const s of arr(b.skills)) if (!sk.has(s)) errs.push(`base "${b.id}": unknown skills group "${s}".`);
      for (const sec of arr(b.sections)) {
        const pool = sec.kind === "experience" ? exp : sec.kind === "projects" ? pr : null;
        for (const it of arr(sec.items)) if (pool && !pool.has(it.id)) errs.push(`base "${b.id}": unknown ${sec.kind} entry "${it.id}".`);
      }
    }
    return errs;
  }

  // Problems in text the model wrote (form answers and drafts).
  function textIssues(text, profile) {
    const out = [];
    const t = String(text || "");
    const rules = (profile && profile.rules) || {};
    for (const w of arr(rules.bannedWords)) {
      const stem = w.toLowerCase().replace(/(ed|ing|e|s)$/, "");
      if (stem.length > 3 && t.toLowerCase().includes(stem)) out.push(`uses "${w}"`);
    }
    for (const c of arr(profile && profile.cannotClaim)) {
      const re = new RegExp(`(^|[^A-Za-z0-9+#.])${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9+#])`, "i");
      if (c.length > 1 && re.test(t)) out.push(`claims "${c}"`);
    }
    return out;
  }

  function stripDashes(text) {
    return String(text || "").replace(/\s*(\u2014|---|\u2013\u2013)\s*/g, ", ");
  }

  root.Profile = { SCHEMA, EXAMPLE, validate, textIssues, stripDashes };
})(typeof globalThis !== "undefined" ? globalThis : this);
