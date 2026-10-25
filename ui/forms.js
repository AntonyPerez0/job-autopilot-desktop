// Form sections shared by the first-run setup and Settings. Each section renders
// into an element and returns { save } where save() resolves to an error
// message, or null when everything was saved.
(function () {
  const api = (p, body) => window.ja.api(p, body);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const icon = (n) => `<svg class="i"><use href="#i-${n}"/></svg>`;
  const uid = () => Math.random().toString(36).slice(2, 9);
  const msg = (el, kind, text) => { el.innerHTML = text ? `<div class="msg ${kind}">${esc(text)}</div>` : ""; };
  const fld = (label, inner, hint) => `<div class="fld"><span>${label}</span>${inner}${hint ? `<small>${hint}</small>` : ""}</div>`;
  const inp = (name, value, attrs = "") => `<input name="${name}" value="${esc(value)}" ${attrs}>`;
  const sel = (name, value, opts) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const radios = (name, value, opts) => `<div class="radio-row">${opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${esc(v)}" ${String(v) === String(value) ? "checked" : ""}>${esc(l)}</label>`).join("")}</div>`;
  const val = (root, name) => { const e = root.querySelector(`[name="${name}"]`); if (!e) return undefined; if (e.type === "radio") { const c = root.querySelector(`[name="${name}"]:checked`); return c ? c.value : ""; } if (e.type === "checkbox") return e.checked; return e.value.trim(); };
  const openUrl = (u) => window.ja.openExternal(u);

  // A list of words or phrases typed one at a time (Enter or comma adds one).
  function tagInput(el, values, placeholder) {
    let list = [...(values || [])];
    const draw = () => {
      el.innerHTML = `<div class="tags">${list.map((t, i) => `<span class="tag">${esc(t)}<button type="button" data-i="${i}" aria-label="Remove">&times;</button></span>`).join("")}
        <input placeholder="${esc(placeholder || "Type and press Enter")}"></div>`;
      const input = el.querySelector("input");
      input.addEventListener("keydown", (e) => {
        if ((e.key === "Enter" || e.key === ",") && input.value.trim()) { e.preventDefault(); add(input.value); }
        if (e.key === "Backspace" && !input.value && list.length) { list.pop(); draw(); el.querySelector("input").focus(); }
      });
      input.addEventListener("blur", () => { if (input.value.trim()) add(input.value); });
      el.querySelectorAll("button[data-i]").forEach((b) => b.onclick = () => { list.splice(Number(b.dataset.i), 1); draw(); });
    };
    const add = (v) => { for (const x of String(v).split(",").map((s) => s.trim()).filter(Boolean)) if (!list.includes(x)) list.push(x); draw(); el.querySelector("input").focus(); };
    draw();
    return { get: () => { const pending = el.querySelector("input").value.trim(); if (pending) add(pending); return list; } };
  }

  // ---------- 1. AI provider ----------
  // OpenRouter, any OpenAI-compatible service, or a model running on this computer (Ollama, LM Studio).
  function ai(el, cfg) {
    const s = cfg.settings.ai;
    const P = cfg.providers;
    const guess = s.provider || (/openrouter\.ai/.test(s.apiBase) ? "openrouter" : /:11434\b/.test(s.apiBase) ? "ollama" : /:1234\b/.test(s.apiBase) ? "lmstudio" : "custom");
    let prov = guess;
    let tested = cfg.hasKey && prov !== "custom";
    const listId = "models-" + uid();
    const draw = () => {
      const p = P[prov];
      const base = prov === guess ? s.apiBase : p.apiBase;
      const model = prov === guess ? s.model : p.model || "";
      el.innerHTML = `<div class="form">
        ${fld("Where the AI runs", radios("prov", prov, [["openrouter", "OpenRouter (recommended)"], ["custom", "Another OpenAI-compatible API"], ["ollama", "Ollama, on this computer"], ["lmstudio", "LM Studio, on this computer"]]))}
        ${p.local ? `<div class="callout blue" style="margin:0"><div><b>A model on your own computer</b>
          Nothing about you leaves this computer for the AI steps, and there is nothing to pay per use. It needs a capable computer
          (16 GB of memory or more, ideally a recent Mac or a graphics card) and a model good at following instructions: about 14 billion
          parameters or more, for example Qwen 3 14B or Gemma 3 12B. Smaller models skip more jobs and leave more questions for you;
          the truth rules, the fact-check and the gate still apply. Each application can take several minutes.
          <ol style="margin:8px 0 0;padding-left:18px">${prov === "ollama"
            ? `<li>Install Ollama and start it.</li><li>Download a model, for example in a terminal: <span class="mono">ollama pull qwen3:14b</span></li><li>Press <strong>Find models</strong>, pick it, and press <strong>Test</strong>.</li>`
            : `<li>Install LM Studio and download a model in it.</li><li>Open the Developer tab, load the model with a <b>context length of 16384 or more</b>, and start the server.</li><li>Press <strong>Find models</strong>, pick it, and press <strong>Test</strong>.</li>`}</ol>
          <button type="button" class="btn sm" style="margin-top:8px" data-link="${esc(p.url)}">${icon("ext")}Get ${esc(p.name.replace(/ \(.*/, ""))}</button></div></div>` : ""}
        <div ${prov === "openrouter" ? "hidden" : ""}>${fld("Server address", inp("apiBase", base, 'placeholder="https://api.example.com/v1"'), p.local ? "Leave this as it is unless you changed the port." : "The address that ends in /v1 (for example https://api.openai.com/v1).")}</div>
        <div ${p.local ? "hidden" : ""}>${fld("API key", `<input name="apiKey" type="password" autocomplete="off" placeholder="${cfg.hasKey ? "Saved. Paste a new key to replace it." : "sk-or-..."}">`,
          `Stored encrypted on this computer only.${prov === "openrouter" ? ` <a href="#" data-link="https://openrouter.ai/settings/keys">Get an OpenRouter key</a> (add a few dollars of credit first).` : ""}`)}</div>
        <div class="form-row">
          ${fld("Model", `<input name="model" list="${listId}" value="${esc(model)}" placeholder="${p.local ? "Press Find models" : ""}">`, prov === "openrouter" ? "Default: z-ai/glm-5.3-flash (fast and cheap)." : "")}
          ${prov === "ollama" ? fld("Context length (tokens)", inp("contextLength", s.contextLength || 16384, 'type="number" min="8192" step="1024"'), "16384 fits a posting and your resume. More needs more memory.") : ""}
        </div>
        <datalist id="${listId}"></datalist>
        <div class="row-actions"><button type="button" class="btn" data-test>${icon("check")}${p.local ? "Test" : "Test key"}</button>
          <button type="button" class="btn ghost" data-models>${icon("list")}${p.local ? "Find models" : "Show available models"}</button></div>
        <div data-msg></div></div>`;
      bind();
    };
    const cur = () => ({ provider: prov, apiBase: prov === "openrouter" ? P.openrouter.apiBase : val(el, "apiBase"), apiKey: P[prov].local ? "" : val(el, "apiKey"),
      model: val(el, "model"), contextLength: Number(val(el, "contextLength")) || undefined });
    const bind = () => {
      const m = el.querySelector("[data-msg]");
      el.querySelectorAll("[name=prov]").forEach((r) => r.onchange = () => { prov = val(el, "prov"); tested = false; draw(); });
      el.querySelectorAll("[data-link]").forEach((a) => a.onclick = (e) => { e.preventDefault(); openUrl(a.dataset.link); });
      el.querySelector("[data-test]").onclick = async () => {
        msg(m, "info", P[prov].local ? "Testing. A local model can take a minute or two the first time it loads..." : "Testing...");
        const r = await api("/api/ai/test", cur());
        tested = !r.error;
        if (r.error) return msg(m, "err", "That did not work: " + r.error);
        msg(m, r.warning ? "err" : "ok", r.warning || (P[prov].local ? "The model works, and it keeps track of long postings." : "The key works with this model."));
      };
      el.querySelector("[data-models]").onclick = async () => {
        msg(m, "info", "Looking for models...");
        const r = await api("/api/ai/models", cur());
        if (r.error) return msg(m, "err", P[prov].local ? `Nothing is answering at ${cur().apiBase}. Is ${P[prov].name.replace(/ \(.*/, "")} running?` : r.error);
        el.querySelector("datalist").innerHTML = r.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}${x.prompt ? ` ($${(x.prompt * 1e6).toFixed(2)}/M in)` : ""}</option>`).join("");
        if (P[prov].local && r.length && !val(el, "model")) el.querySelector("[name=model]").value = r[0].id;
        msg(m, r.length ? "ok" : "err", r.length ? `${r.length} model${r.length > 1 ? "s" : ""} found. Click the Model box to pick one.` : "No models yet. Download one first.");
      };
    };
    draw();
    return {
      async save() {
        const c = cur();
        if (!c.apiBase) return "Enter the server address.";
        if (!P[prov].local && !c.apiKey && !cfg.hasKey) return "Paste your API key.";
        if (!c.model) return P[prov].local ? "Press Find models and pick a model." : "Pick a model.";
        if (!tested || c.apiKey) {
          const r = await api("/api/ai/test", c);
          if (r.error) return "That did not work: " + r.error;
          if (r.warning) return r.warning;
        }
        await api("/api/ai/save", c);
        if (c.apiKey) cfg.hasKey = true;
        cfg.settings.ai = { ...cfg.settings.ai, provider: prov, apiBase: c.apiBase, model: c.model, ...(c.contextLength ? { contextLength: c.contextLength } : {}) };
        return null;
      },
    };
  }

  // ---------- 2a. Resume upload ----------
  function resumes(el, cfg, onImported) {
    let files = [];
    el.innerHTML = `<div class="form">
      <div class="drop" data-drop>${icon("upload")}<div style="margin-top:8px"><b>Drop your resumes here</b> or click to choose</div>
        <small>PDF or Word (.docx). Several versions of your resume give the app more approved pieces to pick from.</small>
        <input type="file" accept=".pdf,.docx" multiple hidden></div>
      <div data-files class="sub-list"></div>
      <details><summary class="muted" style="cursor:pointer">Or paste your resume as text</summary><div class="fld" style="margin-top:10px"><textarea name="text" rows="8" placeholder="Paste the full text of your resume"></textarea></div></details>
      <div class="row-actions"><button type="button" class="btn primary" data-go>${icon("bolt")}Read my resume${cfg.profile ? " again" : ""}</button>
        ${cfg.profile ? `<label class="check"><input type="checkbox" name="merge" checked>Add to what I already approved</label>` : ""}
        <button type="button" class="btn ghost" data-example>Use the example profile to try the app</button></div>
      <div data-msg></div></div>`;
    const drop = el.querySelector("[data-drop]"), input = drop.querySelector("input"), m = el.querySelector("[data-msg]");
    const draw = () => { el.querySelector("[data-files]").innerHTML = files.map((f, i) => `<div class="sub-item" style="grid-template-columns:1fr auto;display:grid;align-items:center">${icon("file")} ${esc(f.name)} <button type="button" class="btn ghost sm" data-rm="${i}">${icon("x")}</button></div>`).join("");
      el.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => { files.splice(Number(b.dataset.rm), 1); draw(); }); };
    const addFiles = (list) => { for (const f of list) if (/\.(pdf|docx)$/i.test(f.name)) files.push(f); else msg(m, "err", `${f.name}: only PDF and .docx files`); draw(); };
    drop.onclick = () => input.click();
    input.onchange = () => addFiles(input.files);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); };
    const b64 = (f) => f.arrayBuffer().then((buf) => { let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); });
    el.querySelector("[data-go]").onclick = async () => {
      const text = val(el, "text");
      if (!files.length && !text) return msg(m, "err", "Add a resume file or paste its text.");
      msg(m, "info", "Reading your resume and turning it into pieces you can approve. This takes up to a minute per resume...");
      el.querySelector("[data-go]").disabled = true;
      const r = await api("/api/resumes/import", text && !files.length ? { text, merge: val(el, "merge") } : { files: await Promise.all(files.map(async (f) => ({ name: f.name, b64: await b64(f) }))), merge: val(el, "merge") });
      el.querySelector("[data-go]").disabled = false;
      if (r.error) return msg(m, "err", r.error);
      msg(m, "ok", "Done. Now review every piece.");
      cfg.profile = r.profile; cfg.answers = r.answers;
      onImported && onImported(r.profile);
    };
    el.querySelector("[data-example]").onclick = async () => {
      const r = await api("/api/profile/example", {});
      cfg.profile = r.profile;
      msg(m, "ok", "Loaded the example profile (Jordan Lee). Replace it with your own before going live.");
      onImported && onImported(r.profile);
    };
    return { save: async () => (cfg.profile ? null : "Read a resume first (or load the example to try the app).") };
  }

  // ---------- 2b. Review: approve every summary, bullet, skill group and layout ----------
  function review(el, cfg) {
    const p = cfg.profile;
    if (!p) { el.innerHTML = `<div class="msg info">Upload a resume first.</div>`; return { save: async () => "Upload a resume first." }; }
    const arr = (x) => (Array.isArray(x) ? x : []);
    const newId = (list, base) => { let i = 1, id = base; const ids = new Set(arr(list).map((x) => x.id)); while (ids.has(id)) id = `${base}${++i}`; return id; };
    const counts = () => {
      let n = 0, ok = 0;
      const c = (x) => { n++; if (x.approved) ok++; };
      for (const k of ["summaries", "headers", "skills", "education", "bases"]) arr(p[k]).forEach(c);
      for (const k of ["experience", "projects"]) arr(p[k]).forEach((e) => arr(e.bullets).forEach(c));
      return { n, ok };
    };
    const item = (path, text, approved, opts = {}) => `<div class="rv-item ${approved ? "ok" : ""}">
      <input type="checkbox" class="approve" data-approve="${path}" ${approved ? "checked" : ""} title="Approve">
      ${opts.input ? `<input type="text" data-edit="${path}" value="${esc(text)}">` : `<textarea data-edit="${path}" rows="${Math.min(8, Math.max(1, Math.ceil(String(text).length / 72)))}">${esc(text)}</textarea>`}
      <div style="display:flex;gap:4px">${opts.preview ? `<button type="button" class="btn ghost sm" data-preview="${esc(opts.preview)}" title="Preview this layout">${icon("eye")}</button>` : ""}
        <button type="button" class="btn ghost sm" data-del="${path}" title="Delete">${icon("trash")}</button></div></div>`;
    const group = (title, key, body, add) => `<div class="rv-group"><div class="rv-head">${title}<span class="right">
      ${add ? `<button type="button" class="btn ghost sm" data-add="${add}">${icon("plus")}Add</button>` : ""}
      <button type="button" class="btn sm" data-all="${key}">${icon("check")}Approve all</button></span></div>${body || `<div class="rv-item"><span></span><span class="muted">Nothing here.</span></div>`}</div>`;
    const draw = () => {
      const c = counts();
      let h = `<div class="banner blue"><div><b>${c.ok} of ${c.n} pieces approved</b>Your resume is only ever assembled from pieces you approve here. Edit anything that is not exactly true, delete what you would never send, then tick it.</div></div>`;
      h += group("Summaries", "summaries", arr(p.summaries).map((s, i) => item(`summaries.${i}.text`, s.text, s.approved)).join(""), "summary");
      for (const [k, title] of [["experience", "Experience"], ["projects", "Projects"]]) {
        arr(p[k]).forEach((e, ei) => {
          const head = `<div class="rv-item"><span></span><div class="form-row">
            <input type="text" data-edit="${k}.${ei}.title" value="${esc(e.title)}" placeholder="Title">
            ${k === "experience" ? `<input type="text" data-edit="${k}.${ei}.org" value="${esc(e.org)}" placeholder="Employer">` : `<input type="text" data-edit="${k}.${ei}.link" value="${esc(e.link || "")}" placeholder="Link">`}
            <input type="text" data-edit="${k}.${ei}.dates" value="${esc(e.dates || "")}" placeholder="Dates"></div>
            <button type="button" class="btn ghost sm" data-del="${k}.${ei}" title="Delete this entry">${icon("trash")}</button></div>
            ${k === "projects" ? `<div class="rv-item"><span></span><label class="check"><input type="checkbox" data-flag="${k}.${ei}.aiBuilt" ${e.aiBuilt ? "checked" : ""}>Built mostly by AI coding agents (answers must say so, and never "I built it")</label><span></span></div>` : ""}`;
          h += group(`${title}: ${esc(e.title || "")}${e.org ? " · " + esc(e.org) : ""}`, `${k}.${ei}.bullets`, head + arr(e.bullets).map((b, bi) => item(`${k}.${ei}.bullets.${bi}.text`, b.text, b.approved)).join(""), `bullet:${k}.${ei}`);
        });
      }
      h += group("Skills", "skills", arr(p.skills).map((s, i) => `<div class="rv-item ${s.approved ? "ok" : ""}"><input type="checkbox" class="approve" data-approve="skills.${i}.text" ${s.approved ? "checked" : ""}>
        <div class="form-row" style="grid-template-columns:200px 1fr"><input type="text" data-edit="skills.${i}.label" value="${esc(s.label)}"><input type="text" data-edit="skills.${i}.items" value="${esc(s.items)}"></div>
        <button type="button" class="btn ghost sm" data-del="skills.${i}">${icon("trash")}</button></div>`).join(""), "skill");
      h += group("Education (as it appears on the resume)", "education", arr(p.education).map((e, i) => `<div class="rv-item ${e.approved ? "ok" : ""}"><input type="checkbox" class="approve" data-approve="education.${i}.text" ${e.approved ? "checked" : ""}>
        <div class="form-row"><input type="text" data-edit="education.${i}.school" value="${esc(e.school)}" placeholder="School"><input type="text" data-edit="education.${i}.detail" value="${esc(e.detail || "")}" placeholder="Degree"><input type="text" data-edit="education.${i}.dates" value="${esc(e.dates || "")}" placeholder="Dates"></div>
        <button type="button" class="btn ghost sm" data-del="education.${i}">${icon("trash")}</button></div>`).join(""), "education");
      h += group("Lines under your name (optional)", "headers", arr(p.headers).map((s, i) => item(`headers.${i}.text`, s.text, s.approved, { input: true })).join(""), "header");
      h += group("Base layouts", "bases", arr(p.bases).map((b, i) => item(`bases.${i}.description`, b.description || b.id, b.approved, { input: true, preview: b.id })).join(""));
      h += `<div class="fld" style="margin-top:6px"><span>A paragraph in your own voice (optional)</span><textarea data-edit="essaySample" rows="3" placeholder="Two or three sentences you wrote yourself. Written answers copy its tone.">${esc(p.essaySample || "")}</textarea></div>
        <div data-msg style="margin-top:12px"></div>`;
      el.innerHTML = h;
      bind();
    };
    const at = (path) => { const parts = path.split("."); let o = p; for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]]; return [o, parts[parts.length - 1]]; };
    const bind = () => {
      el.querySelectorAll("[data-edit]").forEach((e) => e.oninput = () => { const [o, k] = at(e.dataset.edit); o[k] = e.value; });
      el.querySelectorAll("[data-flag]").forEach((e) => e.onchange = () => { const [o, k] = at(e.dataset.flag); o[k] = e.checked; });
      el.querySelectorAll("[data-approve]").forEach((e) => e.onchange = () => { const [o] = at(e.dataset.approve); o.approved = e.checked; e.closest(".rv-item").classList.toggle("ok", e.checked); el.querySelector(".banner b").textContent = `${counts().ok} of ${counts().n} pieces approved`; });
      el.querySelectorAll("[data-del]").forEach((e) => e.onclick = () => { const parts = e.dataset.del.split("."); const idx = Number(parts.pop()); let o = p; for (const x of parts) o = o[x]; o.splice(idx, 1); draw(); });
      el.querySelectorAll("[data-all]").forEach((e) => e.onclick = () => { let o = p; for (const x of e.dataset.all.split(".")) o = o[x]; arr(o).forEach((x) => { x.approved = true; }); draw(); });
      el.querySelectorAll("[data-add]").forEach((e) => e.onclick = () => {
        const a = e.dataset.add;
        if (a === "summary") (p.summaries = arr(p.summaries)).push({ id: newId(p.summaries, "summary"), text: "", approved: false });
        if (a === "skill") (p.skills = arr(p.skills)).push({ id: newId(p.skills, "skills"), label: "Skills", items: "", approved: false });
        if (a === "education") (p.education = arr(p.education)).push({ school: "", detail: "", dates: "", approved: false });
        if (a === "header") (p.headers = arr(p.headers)).push({ id: newId(p.headers, "header"), text: "", approved: false });
        if (a.startsWith("bullet:")) { const [k, i] = a.slice(7).split("."); const en = p[k][Number(i)]; en.bullets.push({ id: newId(en.bullets, "b"), text: "", approved: false }); }
        draw();
      });
      el.querySelectorAll("[data-preview]").forEach((e) => e.onclick = async () => {
        await api("/api/profile/save", { profile: p });
        const r = await api("/api/profile/preview", { base: e.dataset.preview, profile: p });
        const m = el.querySelector("[data-msg]");
        if (r.error) return msg(m, "err", r.error);
        msg(m, r.overflow ? "err" : "ok", r.overflow ? "This layout runs past one page with what is approved. Delete or shorten a bullet." : `Preview opened in a new window${r.slack > 24 ? ` (about ${Math.round(r.slack / 12)} empty lines at the bottom)` : ""}.`);
        window.open(r.url, "_blank");
      });
    };
    draw();
    return {
      async save() {
        // drop empty pieces the user added but never wrote
        p.summaries = arr(p.summaries).filter((s) => String(s.text || "").trim());
        for (const k of ["experience", "projects"]) for (const e of arr(p[k])) e.bullets = arr(e.bullets).filter((b) => String(b.text || "").trim());
        const r = await api("/api/profile/save", { profile: p });
        if (r.error) return r.error;
        const c = counts();
        if (!c.ok) return "Approve at least a summary, some bullets, a skills group and one base layout.";
        if (r.problems && r.problems.length) return "With only the approved pieces: " + r.problems.slice(0, 3).join(" ");
        return null;
      },
    };
  }

  // ---------- 3. Common questions ----------
  const DEM = {
    gender: ["Gender", ["decline", "Male", "Female", "Non-binary"]],
    hispanic: ["Hispanic or Latino", ["decline", "Yes", "No"]],
    race: ["Race", ["decline", "American Indian or Alaska Native", "Asian", "Black or African American", "Native Hawaiian or Other Pacific Islander", "White", "Two or More Races"]],
    veteran: ["Protected veteran", ["decline", "I am not a protected veteran", "I identify as one or more of the classifications of protected veteran"]],
    disability: ["Disability", ["decline", "No, I do not have a disability", "Yes, I have a disability (or previously had a disability)"]],
    lgbtq: ["Sexual orientation / LGBTQ+", ["decline", "Heterosexual", "Gay or Lesbian", "Bisexual", "Queer"]],
  };
  function questions(el, cfg) {
    const a = cfg.answers;
    const eduRow = (e = {}) => `<div class="sub-item" data-edu><div class="form-row">
      ${fld("School", inp("school", e.school))}${fld("Degree", inp("degree", e.degree, 'placeholder="Bachelor of Science, Associate..."'))}${fld("Field of study", inp("field", e.field))}</div>
      <div class="form-row">${fld("Start", inp("start", e.start, 'type="month"'))}${fld("End (or expected)", inp("end", e.end, 'type="month"'))}
      <div style="align-self:end"><button type="button" class="btn ghost sm" data-rm-row>${icon("trash")}Remove</button></div></div></div>`;
    const yearsRow = (y = {}) => `<div class="form-row" data-years style="grid-template-columns:1fr 120px auto">
      <input class="inp" name="ytype" value="${esc(y.type || "")}" placeholder="Kind of work or skill, e.g. Software engineering, Python, Customer support">
      <input class="inp" name="yyears" type="number" min="0" step="0.5" value="${esc(y.years ?? "")}" placeholder="Years">
      <button type="button" class="btn ghost sm" data-rm-row>${icon("trash")}</button></div>`;
    el.innerHTML = `<div class="form">
      <div class="section-t">You</div>
      <div class="form-row">${fld("First name", inp("firstName", a.firstName))}${fld("Last name", inp("lastName", a.lastName))}${fld("Preferred first name", inp("preferredName", a.preferredName), "Optional")}</div>
      <div class="form-row">${fld("Email", inp("email", a.email, 'type="email"'), "The address employers will write to.")}${fld("Phone", inp("phone", a.phone, 'type="tel"'))}</div>
      <div class="form-row">${fld("LinkedIn", inp("linkedin", a.linkedin, 'placeholder="https://www.linkedin.com/in/..."'))}${fld("GitHub", inp("github", a.github))}${fld("Website or portfolio", inp("website", a.website))}</div>
      ${fld("Other links", inp("otherLinks", a.otherLinks), "Separate with spaces.")}
      <div class="section-t">Where you live</div>
      <div class="form-row">${fld("City", inp("city", a.city))}${fld("State / province", inp("state", a.state))}${fld("ZIP / postal code", inp("zip", a.zip))}${fld("Country", inp("country", a.country))}</div>
      ${fld("Street address", inp("street", a.street), "Optional. Only used when a form requires it; leave empty and those forms wait for you.")}
      <div class="section-t">Work authorization</div>
      <div class="form-row">${fld("Country you are applying to work in", inp("authCountry", a.authCountry))}</div>
      <div class="form-row">${fld("Are you legally authorized to work there?", radios("workAuthorized", a.workAuthorized, [["yes", "Yes"], ["no", "No"]]))}
        ${fld("Will you need visa sponsorship, now or later?", radios("needsSponsorship", a.needsSponsorship, [["no", "No"], ["yes", "Yes"]]))}</div>
      <div class="section-t">Education</div>
      <div class="sub-list" data-edu-list>${(a.education || []).map(eduRow).join("")}</div>
      <div><button type="button" class="btn sm" data-add-edu>${icon("plus")}Add school</button></div>
      <div class="section-t">Years of experience</div>
      <p class="hint" style="margin:-4px 0 0">Forms often ask "how many years of X". The app answers with exactly these numbers and never more. A question about something not listed waits for you.</p>
      <div class="sub-list" data-years-list>${(a.years || []).map(yearsRow).join("")}</div>
      <div class="row-actions"><button type="button" class="btn sm" data-add-years>${icon("plus")}Add a kind of experience</button></div>
      <div class="form-row">${fld("All professional work, any field (years)", inp("totalYears", a.totalYears, 'type="number" min="0" step="0.5"'))}
        ${fld("Current or most recent employer", inp("currentEmployer", a.currentEmployer))}${fld("Current or most recent job title", inp("currentTitle", a.currentTitle))}</div>
      <div class="section-t">Availability</div>
      <div class="form-row">${fld("Notice period", inp("noticePeriod", a.noticePeriod, 'placeholder="2 weeks, None..."'))}${fld("When you can start", inp("startAvailability", a.startAvailability, 'placeholder="Two weeks after accepting an offer"'))}</div>
      ${fld("Willing to relocate?", radios("relocation", a.relocation, [["no", "No"], ["radius", "Only for jobs inside my search radius"], ["anywhere", "Yes, anywhere"]]))}
      <div class="form-row">${fld("Willing to travel for work?", radios("travel", a.travel, [["some", "Occasionally"], ["yes", "Yes"], ["no", "No"]]))}
        ${fld("Are you 18 or older?", radios("over18", a.over18, [["yes", "Yes"], ["no", "No"]]))}</div>
      <div class="form-row">${fld("How you heard about the job", inp("heardAbout", a.heardAbout), "The app finds jobs on a job board, so the default is \"Job board\".")}${fld("Desired salary (optional)", inp("salary", a.salary), "Leave empty and the app uses the posting's range or \"open to discussing\".")}</div>
      <div class="section-t">Legal agreements</div>
      ${fld("Arbitration agreements in an application", radios("arbitration", a.arbitration, [["never", "Always ask me (recommended)"], ["plain", "Accept plain arbitration agreements"], ["list", "Accept only for these companies"]]),
        "Jury, class-action and claim waivers, non-competes and questions about criminal history always wait for you, whatever you pick.")}
      <div data-arb-list style="${a.arbitration === "list" ? "" : "display:none"}"></div>
      ${fld("Background checks and drug tests, if you get an offer", radios("screenings", a.screenings, [["ask", "Always ask me"], ["yes", "Yes, I consent"]]),
        "Only for a plain yes/no question. Anything that also waives rights still waits for you.")}
      <div class="section-t">Voluntary self-identification</div>
      <p class="hint" style="margin:-4px 0 0">Answered only when a form asks. "Decline to answer" is the default for each.</p>
      <div class="form-row">${Object.entries(DEM).map(([k, [label, opts]]) => fld(label, sel("dem_" + k, (a.demographics || {})[k] || "decline", opts.map((o) => [o, o === "decline" ? "Decline to answer" : o])))).join("")}</div>
      <div class="section-t">Things you can never claim</div>
      <div data-cannot></div>
      <small class="hint">Skills, tools, credentials or experience you do not have. Any AI-written answer that mentions one is thrown out, and must-haves on this list count as a fail.</small>
    </div>`;
    const cannot = tagInput(el.querySelector("[data-cannot]"), a.cannotClaim, "e.g. Kubernetes, Java, security clearance, management experience");
    const arbList = tagInput(el.querySelector("[data-arb-list]"), a.arbitrationCompanies, "Company names");
    el.querySelectorAll("[name=arbitration]").forEach((r) => r.onchange = () => { el.querySelector("[data-arb-list]").style.display = val(el, "arbitration") === "list" ? "" : "none"; });
    const bindRm = () => el.querySelectorAll("[data-rm-row]").forEach((b) => b.onclick = () => b.closest("[data-edu], [data-years]").remove());
    el.querySelector("[data-add-edu]").onclick = () => { el.querySelector("[data-edu-list]").insertAdjacentHTML("beforeend", eduRow()); bindRm(); };
    el.querySelector("[data-add-years]").onclick = () => { el.querySelector("[data-years-list]").insertAdjacentHTML("beforeend", yearsRow()); bindRm(); };
    bindRm();
    if (!(a.years || []).length) el.querySelector("[data-add-years]").click();
    return {
      async save() {
        const out = {};
        for (const k of ["firstName", "lastName", "preferredName", "email", "phone", "linkedin", "github", "website", "otherLinks", "street", "city", "state", "zip", "country",
          "authCountry", "workAuthorized", "needsSponsorship", "travel", "over18", "currentEmployer", "currentTitle", "noticePeriod", "startAvailability", "relocation", "heardAbout", "salary", "arbitration", "screenings"]) out[k] = val(el, k);
        out.totalYears = Number(val(el, "totalYears")) || 0;
        out.education = [...el.querySelectorAll("[data-edu]")].map((r) => ({ school: val(r, "school"), degree: val(r, "degree"), field: val(r, "field"), start: val(r, "start"), end: val(r, "end") })).filter((e) => e.school);
        out.years = [...el.querySelectorAll("[data-years]")].map((r) => ({ type: val(r, "ytype"), years: Number(val(r, "yyears")) || 0 })).filter((y) => y.type);
        out.demographics = Object.fromEntries(Object.keys(DEM).map((k) => [k, val(el, "dem_" + k)]));
        out.cannotClaim = cannot.get();
        out.arbitrationCompanies = arbList.get();
        if (!out.firstName || !out.lastName) return "Enter your first and last name.";
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) return "Enter a valid email address.";
        if (!out.phone) return "Enter your phone number.";
        if (!out.city) return "Enter your city.";
        for (const e of out.education) if (e.end && e.start && e.end < e.start) return `${e.school}: the end date is before the start date.`;
        cfg.answers = await api("/api/answers/save", { answers: out });
        return null;
      },
    };
  }

  // ---------- 4. Job preferences ----------
  const LEVELS = [["intern", "Internship"], ["junior", "Entry level / junior"], ["middle", "Mid level"], ["senior", "Senior"], ["lead", "Lead / manager"], ["staff", "Staff"], ["principal", "Principal"]];
  function prefs(el, cfg) {
    const p = cfg.prefs;
    let cities = [...(p.cities || [])];
    el.innerHTML = `<div class="form">
      ${fld("Job titles to search for", `<div data-titles></div>`, "Each title is searched on its own. Add the variants you would accept (e.g. Software Engineer, Backend Engineer, Web Developer).")}
      ${fld("What you want the work to involve (optional)", `<div data-keywords></div>`, "Used when the AI screens each posting for fit, e.g. React, payments, healthcare.")}
      ${fld("Title words that rule a job out (optional)", `<div data-titleex></div>`, "Seniority words are handled by the levels below.")}
      <div class="section-t">Where</div>
      <div class="fld"><span>Cities</span><div class="suggest"><input class="inp" data-city placeholder="Start typing a city"><div class="suggest-list" hidden></div></div>
        <div data-cities class="tags" style="margin-top:6px"></div></div>
      <div class="form-row">${fld("Radius", inp("radius", p.radius, 'type="number" min="0" max="500"'))}${fld("Unit", sel("radiusUnit", p.radiusUnit, [["mi", "miles"], ["km", "km"]]))}</div>
      <label class="check"><input type="checkbox" name="remote" ${p.remote ? "checked" : ""}>Also remote jobs open to people in</label>
      <div class="form-row"><div class="fld"><select name="remoteCountry" data-countries></select></div></div>
      <div class="section-t">Level</div>
      <div class="fld"><span>Levels you would accept</span><div class="radio-row">${LEVELS.map(([v, l]) => `<label><input type="checkbox" name="lvl" value="${v}" ${(p.seniority || []).includes(v) ? "checked" : ""}>${l}</label>`).join("")}</div></div>
      <div class="form-row">${fld("Most years of experience a job may require", inp("maxYearsRequired", p.maxYearsRequired, 'type="number" min="0" max="30"'))}
        ${fld("Only postings from the last", sel("postedWithinDays", p.postedWithinDays, [[3, "3 days"], [7, "7 days"], [14, "14 days"], [30, "30 days"], [60, "60 days"]]))}</div>
      <div class="section-t">Companies</div>
      ${fld("Companies to never apply to", `<div data-exclude></div>`, "Your current employer, places you already work with, anywhere you would not go.")}
      <label class="check"><input type="checkbox" name="excludeAgencies" ${p.excludeAgencies ? "checked" : ""}>Skip recruiting agencies and repost sites (${esc((cfg.agencies || []).slice(0, 5).join(", "))}...)</label>
      ${fld("Jobs you already applied to elsewhere (optional)", `<textarea name="alreadyApplied" rows="4" placeholder="One per line: a posting link, or Company - Job title">${esc(p.alreadyApplied || "")}</textarea>`, "The app never applies to these.")}
    </div>`;
    const titles = tagInput(el.querySelector("[data-titles]"), p.titles, "e.g. Software Engineer");
    const keywords = tagInput(el.querySelector("[data-keywords]"), p.keywords, "e.g. React");
    const titleEx = tagInput(el.querySelector("[data-titleex]"), p.titleExclude, "e.g. mechanical, sales");
    const exclude = tagInput(el.querySelector("[data-exclude]"), p.excludeCompanies, "Company name");
    const drawCities = () => {
      const host = el.querySelector("[data-cities]");
      host.innerHTML = cities.length ? cities.map((c, i) => `<span class="tag">${icon("pin")}${esc(c.label || c.name)}<button type="button" data-i="${i}">&times;</button></span>`).join("") : `<span class="muted" style="padding:0 6px">No cities yet</span>`;
      host.querySelectorAll("button").forEach((b) => b.onclick = () => { cities.splice(Number(b.dataset.i), 1); drawCities(); });
    };
    drawCities();
    const box = el.querySelector("[data-city]"), list = el.querySelector(".suggest-list");
    let t;
    box.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
      const r = await api("/api/cities?q=" + encodeURIComponent(box.value));
      list.hidden = !r.length;
      list.innerHTML = r.map((c, i) => `<div data-i="${i}">${esc(c.label)}</div>`).join("");
      list.querySelectorAll("div").forEach((d) => d.onclick = () => { const c = r[Number(d.dataset.i)]; if (!cities.some((x) => x.label === c.label)) cities.push(c); box.value = ""; list.hidden = true; drawCities(); });
    }, 150); };
    box.onblur = () => setTimeout(() => { list.hidden = true; }, 200);
    api("/api/countries").then((cs) => { el.querySelector("[data-countries]").innerHTML = cs.map((c) => `<option value="${c.code}" ${c.code === p.remoteCountry ? "selected" : ""}>${esc(c.name)}</option>`).join(""); });
    return {
      async save() {
        const out = {
          titles: titles.get(), keywords: keywords.get(), titleExclude: titleEx.get(), excludeCompanies: exclude.get(),
          cities, radius: Number(val(el, "radius")) || 0, radiusUnit: val(el, "radiusUnit"), remote: val(el, "remote"), remoteCountry: val(el, "remoteCountry") || "US",
          seniority: [...el.querySelectorAll("[name=lvl]:checked")].map((x) => x.value), maxYearsRequired: Number(val(el, "maxYearsRequired")) || 0,
          postedWithinDays: Number(val(el, "postedWithinDays")) || 14, excludeAgencies: val(el, "excludeAgencies"), alreadyApplied: val(el, "alreadyApplied"),
        };
        out.internships = out.seniority.includes("intern");
        if (!out.titles.length) return "Add at least one job title.";
        if (!out.cities.length && !out.remote) return "Add a city, or allow remote jobs.";
        if (!out.seniority.length) return "Pick at least one level.";
        cfg.prefs = await api("/api/prefs/save", { prefs: out });
        return null;
      },
    };
  }

  // ---------- 5. Mailbox (optional) ----------
  function mailbox(el, cfg) {
    const m0 = cfg.settings.mailbox || {};
    const presets = cfg.presets;
    let preset = m0.preset || "gmail";
    const draw = () => {
      const pr = presets[preset];
      el.innerHTML = `<div class="form">
        <p class="hint" style="margin:0">Optional. Greenhouse sometimes emails a security code that must be typed into the form; with your mailbox connected the app reads it and finishes the application. It also uses employers' "thank you for applying" emails to avoid applying twice. The app only reads; it never sends, deletes or marks anything.</p>
        ${fld("Email provider", radios("preset", preset, Object.entries(presets).map(([k, v]) => [k, v.name])))}
        <div class="callout ${pr.unsupported ? "amber" : "blue"}" style="margin:0"><div><b>${pr.unsupported ? "Not supported directly" : "Create an app password"}</b><ol style="margin:6px 0 0;padding-left:18px">${pr.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
          ${pr.appPasswordUrl ? `<button type="button" class="btn sm" style="margin-top:8px" data-open="${esc(pr.appPasswordUrl)}">${icon("ext")}Open ${esc(pr.name)} settings</button>` : ""}</div></div>
        ${pr.unsupported ? "" : `<div class="form-row">${fld("Email address", inp("user", m0.user || cfg.answers.email || "", 'type="email"'), "Must be the address you put on applications (or one it forwards to).")}
          ${fld("App password", `<input name="pass" type="password" autocomplete="off" placeholder="${cfg.hasMailPassword ? "Saved. Paste a new one to replace it." : "App password"}">`)}</div>
          <div class="form-row" ${preset === "other" ? "" : "hidden"}>${fld("IMAP server", inp("host", m0.host || pr.host))}${fld("Port", inp("port", m0.port || 993, 'type="number"'))}</div>
          <div class="row-actions"><button type="button" class="btn" data-test>${icon("check")}Test connection</button>
          ${cfg.settings.mailbox ? `<button type="button" class="btn ghost danger" data-remove>${icon("trash")}Disconnect</button>` : ""}</div>`}
        <div data-msg></div></div>`;
      el.querySelectorAll("[name=preset]").forEach((r) => r.onchange = () => { preset = val(el, "preset"); draw(); });
      el.querySelectorAll("[data-open]").forEach((b) => b.onclick = () => openUrl(b.dataset.open));
      const m = el.querySelector("[data-msg]");
      const t = el.querySelector("[data-test]");
      if (t) t.onclick = async () => { msg(m, "info", "Connecting..."); const r = await api("/api/mail/test", cur()); msg(m, r.error ? "err" : "ok", r.error || "Connected. The app can read this mailbox."); };
      const rm = el.querySelector("[data-remove]");
      if (rm) rm.onclick = async () => { await api("/api/mail/remove", {}); cfg.settings.mailbox = null; cfg.hasMailPassword = false; draw(); };
    };
    const cur = () => ({ preset, host: preset === "other" ? val(el, "host") : presets[preset].host, port: preset === "other" ? val(el, "port") : presets[preset].port, user: val(el, "user"), pass: val(el, "pass") });
    draw();
    return {
      async save() {
        const c = cur();
        if (presets[preset].unsupported || (!c.user && !c.pass)) return null; // skipped
        if (!c.pass && !cfg.hasMailPassword) return "Paste the app password, or clear the email address to skip this step.";
        const r = await api("/api/mail/test", c);
        if (r.error) return r.error;
        await api("/api/mail/save", c);
        cfg.hasMailPassword = true;
        cfg.settings.mailbox = { preset, host: c.host, port: c.port, user: c.user };
        return null;
      },
    };
  }

  // ---------- Settings only: how the autopilot runs ----------
  function running(el, cfg) {
    const s = cfg.settings;
    el.innerHTML = `<div class="form">
      <div class="form-row">${fld("Daily limit", inp("dailyCap", s.dailyCap, 'type="number" min="0" max="100"'), "Applications per day, at most.")}
        ${fld("The day starts at", sel("dayStartsAtHour", s.dayStartsAtHour, [...Array(24)].map((_, h) => [h, new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" })])), "Your computer's time zone.")}
        ${fld("Minutes between applications", inp("minutesBetweenApplies", s.minutesBetweenApplies, 'type="number" min="1" max="240"'))}</div>
      <div class="form-row">${fld("Search for new jobs every", sel("searchEveryMinutes", s.searchEveryMinutes, [[60, "hour"], [120, "2 hours"], [240, "4 hours"], [720, "12 hours"], [1440, "day"]]))}
        ${fld("Tries per job", inp("maxAttempts", s.maxAttempts, 'type="number" min="1" max="5"'))}</div>
      <div class="section-t">Browser</div>
      ${fld("Browser to apply with", radios("browser", s.browser, [["auto", "Automatic (Chrome, then Edge, then Chromium)"], ["chrome", "Google Chrome"], ["msedge", "Microsoft Edge"], ["chromium", "Chromium (downloaded by the app)"]]))}
      ${fld("The browser window while applying", radios("windowMode", s.windowMode || (s.headless ? "headless" : "minimized"), [["minimized", "Minimized (recommended)"], ["visible", "In front, so I can watch"], ["headless", "No window at all"]]),
        "Minimized keeps it out of your way in the Dock or taskbar; \"Show the browser\" on the Overview brings it up. With no window at all, some sites are more likely to ask for a security code.")}
      <div class="row-actions"><button type="button" class="btn sm" data-detect>${icon("search")}Check browsers</button><button type="button" class="btn sm" data-install>${icon("upload")}Download Chromium now</button></div>
      <div data-msg></div></div>`;
    const m = el.querySelector("[data-msg]");
    el.querySelector("[data-detect]").onclick = async () => { msg(m, "info", "Checking..."); const r = await api("/api/browser/detect", {}); msg(m, "ok", `Chrome: ${r.chrome ? "found" : "not found"} · Edge: ${r.msedge ? "found" : "not found"} · Chromium: ${r.chromium ? "downloaded" : "not downloaded"}`); };
    el.querySelector("[data-install]").onclick = async () => { msg(m, "info", "Downloading Chromium (about 150 MB)..."); const r = await api("/api/browser/install", {}); msg(m, r.error ? "err" : "ok", r.error || "Chromium is ready."); };
    return {
      async save() {
        const out = {};
        for (const k of ["dailyCap", "dayStartsAtHour", "minutesBetweenApplies", "searchEveryMinutes", "maxAttempts"]) out[k] = Number(val(el, k));
        out.browser = val(el, "browser"); out.windowMode = val(el, "windowMode"); out.headless = out.windowMode === "headless";
        cfg.settings = await api("/api/settings", out);
        return null;
      },
    };
  }

  window.Forms = { ai, resumes, review, questions, prefs, mailbox, running, esc, icon, msg };
})();
