"use strict";
// Tailoring: the model reads the posting and the page's form fields, and
// returns a plan that only SELECTS approved pieces of the profile by id.
// Everything it returns is checked here; anything invalid falls back to the
// base resume. The model writes free text only for form answers, and those
// are checked against the banned words and the cannot-claim list.

(function (root) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  const byId = (list, id) => arr(list).find((x) => x.id === id);
  const stem = (id) => String(id).split("_")[0];
  const SLACK_TARGET = 24;

  // ---------- model call (any OpenAI-compatible API; OpenRouter by default) ----------

  async function chat(settings, messages, { json = true, temperature = 0.2 } = {}) {
    if (!settings.apiKey) throw new Error("Add your API key in the add-on's Options first.");
    const base = (settings.apiBase || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
    const body = { model: settings.model, messages, temperature };
    if (json) body.response_format = { type: "json_object" };
    const res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer " + settings.apiKey, "content-type": "application/json",
        "HTTP-Referer": "https://github.com/AntonyPerez0/job-autopilot-desktop", "X-Title": "Job Autopilot",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Model API ${res.status}: ${(data.error && data.error.message) || JSON.stringify(data).slice(0, 200)}`);
    const text = (((data.choices || [])[0] || {}).message || {}).content || "";
    if (!json) return text;
    return parseJSON(text);
  }

  function parseJSON(text) {
    const t = String(text).replace(/^\s*```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try { return JSON.parse(t); } catch (e) {
      const m = t.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error("The model did not return JSON.");
    }
  }

  // ---------- prompt ----------

  function catalog(p) {
    const bl = (e) => Object.fromEntries(arr(e.bullets).map((b) => [b.id, b.text]));
    return {
      headers: Object.fromEntries(arr(p.headers).map((h) => [h.id, h.text])),
      summaries: Object.fromEntries(arr(p.summaries).map((s) => [s.id, s.text])),
      experience: Object.fromEntries(arr(p.experience).map((e) => [e.id, {
        role: `${e.title}, ${e.org} (${e.dates})`, minBullets: e.minBullets || 2, bullets: bl(e) }])),
      projects: Object.fromEntries(arr(p.projects).map((e) => [e.id, Object.assign({ title: e.title, bullets: bl(e) },
        e.aiBuilt ? { builtWithAiAgents: true, alwaysIncludeBullets: e.pinned || [] } : {})])),
      skills: Object.fromEntries(arr(p.skills).map((s) => [s.id, `${s.label}: ${s.items}`])),
      bases: Object.fromEntries(arr(p.bases).map((b) => [b.id, { description: b.description, header: b.header || null,
        summary: b.summary, skills: b.skills, sections: b.sections }])),
    };
  }

  // The user's own calendar date, not UTC (11 PM in California is already tomorrow in UTC).
  function localDate(d = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`;
  }

  function prompt(profile, posting) {
    const rules = profile.rules || {};
    const fields = arr(posting.fields).map((f, i) => {
      let s = `${i}. ${f.label} [${f.type}${f.required ? ", required" : ""}]`;
      if (f.options && f.options.length) s += " options: " + f.options.slice(0, 40).join(" | ");
      return s;
    }).join("\n");
    const system = `You tailor a one-page resume and prepare answers for a job application form, for ${profile.name}.

ABSOLUTE RULES
- The resume is ONLY assembled from the catalog, by id. You write no resume text. Never invent ids.
- Pick the closest base. Keep its layout, bullets and summary unless the posting clearly favors other approved pieces.
  You may: pick another approved summary id, swap bullets for more relevant ones of the same entry, reorder and
  swap projects (lead with what the posting values most), pick skills group ids (same count as the base), and a
  header id or null.
- Experience entries keep at least their minBullets. A project marked builtWithAiAgents always includes its
  alwaysIncludeBullets.
- "extra" lists more approved bullets ("entryId.bulletId"), best first, to add if the page has room. Never two
  bullets that state the same facts (ids sharing the part before "_" are variants of one fact).
- Be honest. In "fit.hardFails" list only must-have requirements the candidate clearly fails, judged from the
  catalog and this cannot-claim list: ${JSON.stringify(arr(profile.cannotClaim).slice(0, 200))}. Preferred or
  nice-to-have items are not hard fails. Quote the posting.
- "notClaimed": what the posting wants that the candidate cannot claim, each with the honest reason.

FORM ANSWERS: answer EVERY form field, each with its index "i" and its exact "label" as listed. The candidate
wants the whole form filled; they review it and press Submit themselves.
- kind "fill": the value comes from the candidate's standard answers or catalog facts. For fields with options,
  the value is the exact text of one option. One value per field: a link field that offers several kinds of link
  gets one URL (the portfolio or website if there is one, else LinkedIn). A checkbox whose own label is the
  answer gets that label as its value.
- Employment questions ("have you ever worked at X", "are you or were you a government employee", "employed by
  Acme Corp") are answered from the work history in the catalog, which lists every job the candidate has held: "No"
  when no such employer is there. Those are "fill". Citizenship and residency questions follow the standard
  answers (a U.S. citizen is not a citizen or resident of a sanctioned country).
- Yes/no questions about things the facts cannot show (a family member's government job, past debarment or
  sanctions, conflicts of interest) are "suggest" with "No" and a note to confirm it.
- kind "suggest": the facts do not settle it, but a sensible, honest choice exists. Give the value (exact option
  text where there are options) and a one-line "note" on why. Use this for: preferences and rankings (office
  location: closest to where the candidate lives first; team or engineer type: what the resume shows most);
  start date or availability windows consistent with the facts (graduation date, current job); "do you have a
  deadline or competing offer" (answer that there is none unless the facts say otherwise); how did you hear
  about us (the company careers site); preferred name (the first name); relocation (yes, for the offices the
  posting lists, unless the facts say otherwise); salary (the middle of a range the posting states, else
  "Open to discussing the posted range"); demographic, veteran and disability questions (the candidate's
  standard answer if there is one, else the option that declines to answer); generic consent, privacy,
  terms and "my answers are true" boxes ("Yes"). Never tick marketing, newsletter or SMS opt-ins.
- kind "skip": optional fields with nothing true to put in them (GPA, test scores, transcripts, pronouns,
  conferences, a cover letter upload, "school not listed" when the school is in the list). Leave them empty.
- kind "decide" with a "note": only required fields that need a fact the profile does not have and that must
  never be guessed: a date, number, score, address or name the facts do not state exactly (an education start
  year when only the end date is known, a required GPA), criminal history, and anything legally binding beyond
  a generic consent box. The note says what to add to the profile's answers so it fills next time.
- kind "draft": free-text questions you can answer honestly from catalog facts only (why this company, tell us
  about a project). First person, plain and a little dry, in the voice of this sample: ${JSON.stringify(profile.essaySample || "")}
  At most 120 words unless the field asks for more. Never invent numbers or claims.
- Signature fields get the candidate's full legal name; a "today's date" or signing-date field gets today's date,
  ${localDate()} (MM/DD/YYYY; write it another way only if the field asks). These are "fill".
- kind "resume": resume or CV upload fields.
- Never use these words: ${JSON.stringify(arr(rules.bannedWords))}.${rules.noEmDash ? " Never use em dashes." : ""}
${rules.instructions ? "- " + rules.instructions : ""}

Return JSON only:
{"employer": "...", "jobTitle": "...",
 "fit": {"hardFails": [{"requirement": "quote", "why": "..."}]},
 "base": "baseId", "header": "headerId or null", "summary": "summaryId", "skills": ["skillId"],
 "sections": [{"kind": "projects|experience|education", "items": [{"id": "entryId", "bullets": ["bulletId"]}]}],
 "extra": ["entryId.bulletId"],
 "notClaimed": [{"what": "...", "why": "..."}],
 "answers": [{"i": 0, "label": "the field's label", "kind": "fill|suggest|draft|skip|decide|resume", "value": "...", "note": "..."}]}`;

    const user = `CATALOG
${JSON.stringify(catalog(profile))}

CANDIDATE'S STANDARD ANSWERS
${arr(profile.answers).map((a) => `${a.label}: ${a.value}`).join("\n")}

POSTING (${posting.url})
${String(posting.text || "").slice(0, 24000)}

FORM FIELDS ON THE PAGE
${fields || "(none found on this page)"}`;
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }

  // ---------- plan -> checked spec ----------

  function entryOf(profile, kind, id) {
    return byId(kind === "experience" ? profile.experience : profile.projects, id);
  }

  function withPinned(entry, bullets) {
    const pins = arr(entry.pinned).filter((b) => byId(entry.bullets, b));
    let out = bullets.filter((b) => !pins.includes(b));
    for (const pin of pins.reverse()) {
      const after = entry.pinnedAfter && out.indexOf(entry.pinnedAfter);
      if (after >= 0 && entry.pinnedAfter) out.splice(after + 1, 0, pin);
      else out.unshift(pin);
    }
    return out;
  }

  function cleanItems(profile, kind, items) {
    const seen = new Set();
    const out = [];
    for (const it of arr(items)) {
      const e = it && entryOf(profile, kind, it.id);
      if (!e || seen.has(e.id)) continue;
      seen.add(e.id);
      const stems = new Set();
      let b = arr(it.bullets).filter((x) => byId(e.bullets, x) && !stems.has(stem(x)) && stems.add(stem(x)));
      if (kind === "experience") {
        const min = e.minBullets || 2;
        for (const extra of arr(e.bullets)) {
          if (b.length >= min) break;
          if (!b.includes(extra.id) && !b.some((x) => stem(x) === stem(extra.id))) b.push(extra.id);
        }
      }
      b = withPinned(e, b);
      if (!b.length) continue;
      out.push(Object.assign({ id: e.id, bullets: b }, it.titleVariant ? { titleVariant: it.titleVariant } : {}));
    }
    return out;
  }

  function checkPlan(profile, plan) {
    const notes = [];
    plan = plan || {};
    const base = byId(profile.bases, plan.base) || arr(profile.bases)[0];
    if (plan.base && base.id !== plan.base) notes.push(`Unknown base "${plan.base}", used ${base.id}.`);
    const summary = byId(profile.summaries, plan.summary) ? plan.summary : base.summary;
    if (plan.summary && summary !== plan.summary) notes.push("The model named a summary that is not approved; used the base's.");
    let skills = arr(plan.skills).filter((s) => byId(profile.skills, s));
    if (!skills.length) skills = arr(base.skills);
    const header = plan.header && byId(profile.headers, plan.header) ? plan.header : (plan.header === undefined ? base.header : null);
    const kinds = arr(base.sections).map((s) => s.kind);
    let sections = arr(plan.sections).filter((s) => s && kinds.includes(s.kind));
    const have = new Set(sections.map((s) => s.kind));
    for (const s of arr(base.sections)) if (!have.has(s.kind)) sections.push(s);
    sections = sections.filter((s, i, a) => a.findIndex((t) => t.kind === s.kind) === i).map((s) => {
      if (s.kind === "education") return { kind: "education" };
      let items = cleanItems(profile, s.kind, s.items);
      if (!items.length) items = cleanItems(profile, s.kind, (arr(base.sections).find((b) => b.kind === s.kind) || {}).items);
      return { kind: s.kind, items };
    });
    const extra = arr(plan.extra).map((x) => String(x).split(".")).filter(([e, b]) => {
      const en = byId(profile.experience, e) || byId(profile.projects, e);
      return en && byId(en.bullets, b);
    });
    return { spec: { base: base.id, header, summary, skills, sections }, extra, notes };
  }

  // ---------- spec -> document -> PDF, filling the page ----------

  function contactLines(p) {
    const c = p.contact || {};
    const short = (u) => String(u || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    const first = [c.location, c.email, c.phone, short(c.linkedin)].filter(Boolean).join(" | ");
    const second = [short(c.github), short(c.website)].filter(Boolean).join(" | ");
    return [first, second].filter(Boolean);
  }

  function toDoc(profile, spec) {
    const titles = { experience: "Experience", projects: "Projects", education: "Education" };
    return {
      name: profile.name,
      contactLines: contactLines(profile),
      header: spec.header ? (byId(profile.headers, spec.header) || {}).text : null,
      summary: (byId(profile.summaries, spec.summary) || {}).text || "",
      skills: spec.skills.map((s) => byId(profile.skills, s)).filter(Boolean),
      sections: spec.sections.map((s) => {
        if (s.kind === "education") return { kind: "education", title: titles.education, entries: arr(profile.education) };
        return {
          kind: s.kind, title: titles[s.kind],
          entries: s.items.map((it) => {
            const e = entryOf(profile, s.kind, it.id);
            const title = (it.titleVariant && e.titleVariants && e.titleVariants[it.titleVariant]) || e.title;
            return Object.assign({}, e, { title, bullets: it.bullets.map((b) => byId(e.bullets, b).text) });
          }),
        };
      }),
    };
  }

  function cloneSpec(s) { return JSON.parse(JSON.stringify(s)); }

  function entries(spec) {
    return spec.sections.filter((s) => s.items).flatMap((s) => s.items.map((it) => ({ kind: s.kind, it })));
  }

  // Shrink an overflowing page: swap a bullet for a shorter variant of the same fact,
  // else drop the last droppable bullet of the longest entry, else the last project.
  function shrink(profile, spec) {
    const all = entries(spec).reverse();
    for (const { kind, it } of all) {
      const e = entryOf(profile, kind, it.id);
      for (let k = it.bullets.length - 1; k >= 0; k--) {
        const cur = byId(e.bullets, it.bullets[k]);
        const alt = arr(e.bullets).filter((b) => stem(b.id) === stem(cur.id) && b.id !== cur.id &&
          b.text.length < cur.text.length - 15 && !it.bullets.includes(b.id)).sort((a, b) => a.text.length - b.text.length)[0];
        if (alt) { it.bullets[k] = alt.id; return true; }
      }
    }
    const droppable = all.map(({ kind, it }) => {
      const e = entryOf(profile, kind, it.id);
      const min = kind === "experience" ? (e.minBullets || 2) : 1;
      const free = it.bullets.filter((b) => !arr(e.pinned).includes(b));
      return { it, e, n: it.bullets.length, ok: it.bullets.length > min && free.length };
    }).filter((x) => x.ok).sort((a, b) => b.n - a.n)[0];
    if (droppable) {
      const free = droppable.it.bullets.filter((b) => !arr(droppable.e.pinned).includes(b));
      droppable.it.bullets.splice(droppable.it.bullets.lastIndexOf(free[free.length - 1]), 1);
      return true;
    }
    const proj = spec.sections.find((s) => s.kind === "projects");
    if (proj && proj.items.length > 1) { proj.items.pop(); return true; }
    return false;
  }

  function candidates(profile, spec, extra) {
    const out = [];
    const onPage = new Map(entries(spec).map(({ kind, it }) => [it.id, { kind, it }]));
    for (const [e, b] of extra) if (onPage.has(e)) out.push([e, b]);
    // One line from each entry in turn, so a long first job does not take all the room.
    const lists = [...onPage].map(([id, { kind }]) => arr(entryOf(profile, kind, id).bullets).map((b) => [id, b.id]));
    for (let k = 0; lists.some((l) => k < l.length); k++) for (const l of lists) if (l[k]) out.push(l[k]);
    return out.filter(([e, b], i, a) => a.findIndex((x) => x[0] === e && x[1] === b) === i);
  }

  async function fit(profile, spec, extra) {
    let cur = cloneSpec(spec);
    let r = await ResumePDF.render(toDoc(profile, cur));
    const startSlack = r.slack;
    for (let n = 0; r.overflow && n < 30; n++) {
      if (!shrink(profile, cur)) break;
      r = await ResumePDF.render(toDoc(profile, cur));
    }
    let tries = 0;
    for (const [eid, bid] of candidates(profile, cur, extra)) {
      if (r.overflow || r.slack <= SLACK_TARGET || tries > 40) break;
      const all = entries(cur), at = all.findIndex((x) => x.it.id === eid);
      const { it, kind } = all[at] || {};
      if (!it || it.bullets.includes(bid) || it.bullets.some((b) => stem(b) === stem(bid))) continue;
      // Recruiters read 3 to 5 lines for the latest job and 2 or 3 for the others: white space beats a longer list.
      const first = all.findIndex((x) => x.kind === kind);
      if (it.bullets.length >= (kind === "experience" && at === first ? 5 : 3)) continue;
      tries++;
      const next = cloneSpec(cur);
      entries(next).find((x) => x.it.id === eid).it.bullets.push(bid);
      const r2 = await ResumePDF.render(toDoc(profile, next));
      if (!r2.overflow) { cur = next; r = r2; }
    }
    const warnings = [];
    if (r.overflow) warnings.push("The resume still runs past one page. Remove a bullet in your profile's base layout.");
    else if (r.slack > SLACK_TARGET) warnings.push(`The page has ${r.slack}pt blank at the bottom (about ${Math.round(r.slack / 12)} lines). Your profile has no more fitting bullets.`);
    return { spec: cur, pdf: r.bytes, slack: r.slack, overflow: r.overflow, startSlack, warnings };
  }

  // ---------- form kit (the same shape content.js fills from) ----------

  function kit(profile, plan, fields, resumeName) {
    const out = [];
    const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    for (const a of arr(plan.answers)) {
      if (!a) continue;
      // The label wins over the index: a model that miscounts must not put an answer on the wrong question.
      let f = arr(fields)[a.i];
      if (a.label && (!f || key(f.label) !== key(a.label))) {
        const k = key(a.label);
        // "When are you available?" for the field "When are you available?: Q4 2026": prefixes count.
        f = arr(fields).find((x) => key(x.label) === k) ||
          arr(fields).find((x) => k.length > 8 && (key(x.label).startsWith(k) || k.startsWith(key(x.label)))) ||
          (f && key(f.label).slice(0, 20) === k.slice(0, 20) ? f : null);
      }
      if (!f) continue;
      if (a.kind === "skip") { out.push({ label: f.label, value: "", kind: "blank" }); continue; }
      let kind = { fill: "text", suggest: "suggest", draft: "draft", decide: "decide", resume: "file" }[a.kind] || "decide";
      let value = profile.rules && profile.rules.noEmDash ? Profile.stripDashes(a.value) : String(a.value || "");
      let note = a.note ? String(a.note) : "";
      if (kind === "text" || kind === "draft" || kind === "suggest") {
        const issues = Profile.textIssues(value, profile);
        if (!value.trim()) { kind = "decide"; note = note || "No answer from your facts"; }
        else if (issues.length) { note = `AI answer ${issues.join(", ")}; write it yourself. It said: ${value}`; kind = "decide"; value = ""; }
      }
      if (kind === "file") { value = resumeName; }
      if (kind === "decide") value = "";
      out.push({ label: f.label, value, kind, note, file: kind === "file" ? resumeName : undefined, fieldIndex: a.i });
    }
    // Standard answers last: they fill fields the model skipped.
    for (const a of arr(profile.answers)) out.push({ label: a.label, value: a.value, kind: "text" });
    if (!out.some((k) => k.kind === "file")) out.push({ label: "Resume/CV", value: resumeName, kind: "file", file: resumeName });
    return out;
  }

  function fileName(profile, plan) {
    const last = String(profile.name || "Resume").trim().split(/\s+/).pop();
    const tok = (s) => String(s || "").replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean).slice(0, 3)
      .map((w) => w[0].toUpperCase() + w.slice(1)).join("");
    const real = (x) => (/\b(not stated|unknown|n\/a|not (given|listed|shown))\b/i.test(String(x || "")) ? "" : x);
    return [last, tok(real(plan.employer)), tok(real(plan.jobTitle))].filter(Boolean).join("_") + ".pdf";
  }

  // ---------- profile from pasted resume text ----------

  async function profileFromText(settings, text) {
    const sys = `Turn this resume into JSON in exactly this shape (an example follows). Use only facts in the text.
Every bullet keeps the resume's own wording. Make one base layout that reproduces the resume as given, and one
summary from the resume's own summary (or none if it has none). Put contact facts and work authorization facts
the text states into "answers". Leave cannotClaim empty. Return JSON only.
EXAMPLE: ${JSON.stringify(Profile.EXAMPLE)}`;
    const p = await chat(settings, [{ role: "system", content: sys }, { role: "user", content: String(text).slice(0, 30000) }]);
    p.schema = Profile.SCHEMA;
    p.rules = p.rules || Profile.EXAMPLE.rules;
    return p;
  }

  root.Tailor = { chat, prompt, catalog, checkPlan, toDoc, fit, kit, fileName, profileFromText, SLACK_TARGET };
})(typeof globalThis !== "undefined" ? globalThis : this);
