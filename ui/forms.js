// Form sections shared by the first-run setup and Settings. Each section renders
// into an element and returns { save } where save() resolves to an error
// message, or null when everything was saved.
(function () {
  const api = (p, body) => window.ja.api(p, body);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const icon = (n) => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
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
        ${prov === "openrouter" ? `<ol class="steps-list">
          <li><b>Make a free OpenRouter account.</b> <button type="button" class="btn sm" data-link="https://openrouter.ai/sign-up">${icon("ext")}Open OpenRouter</button></li>
          <li><b>Add $5 of credit</b> (Settings, then Credits). That's enough for hundreds of applications.</li>
          <li><b>Create a key</b> (Settings, then Keys, then Create), copy it, and paste it below. <button type="button" class="btn sm ghost" data-link="https://openrouter.ai/settings/keys">${icon("ext")}Open the Keys page</button></li></ol>` : ""}
        <details class="more" ${prov === "openrouter" ? "" : "open"}><summary><b>Other ways to connect an AI</b><span>Another service, or a free model on this computer</span></summary>
          <div class="form">${fld("Where the AI runs", radios("prov", prov, [["openrouter", "OpenRouter (recommended)"], ["custom", "Another OpenAI-compatible service"], ["ollama", "Ollama, on this computer"], ["lmstudio", "LM Studio, on this computer"]]))}</div></details>
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
        <div ${p.local ? "hidden" : ""}>${fld(prov === "openrouter" ? "Paste your key here" : "API key", `<input name="apiKey" type="password" autocomplete="off" placeholder="${cfg.hasKey ? "Saved. Paste a new key to replace it." : "sk-or-..."}">`,
          `Stored encrypted on this computer only.${prov === "openrouter" ? ` <a href="#" data-link="https://openrouter.ai/settings/keys">Get an OpenRouter key</a> (add a few dollars of credit first).` : ""}`)}</div>
        <div class="form-row" ${prov === "openrouter" ? "data-adv hidden" : ""}>
          ${fld("Model", `<input name="model" list="${listId}" value="${esc(model)}" placeholder="${p.local ? "Press Find models" : ""}">`, prov === "openrouter" ? "Default: z-ai/glm-5.3-flash (fast and cheap)." : "")}
          ${prov === "ollama" ? fld("Context length (tokens)", inp("contextLength", s.contextLength || 16384, 'type="number" min="8192" step="1024"'), "16384 fits a posting and your resume. More needs more memory.") : ""}
        </div>
        <datalist id="${listId}"></datalist>
        <div class="row-actions"><button type="button" class="btn" data-test>${icon("check")}${p.local ? "Test" : "Test key"}</button>
          <button type="button" class="btn ghost" data-models ${prov === "openrouter" ? "data-adv hidden" : ""}>${icon("list")}${p.local ? "Find models" : "Show available models"}</button>
          ${prov === "openrouter" ? `<a href="#" class="muted" data-show-adv>Choose a different model</a>` : ""}</div>
        <div data-msg></div></div>`;
      bind();
    };
    const cur = () => ({ provider: prov, apiBase: prov === "openrouter" ? P.openrouter.apiBase : val(el, "apiBase"), apiKey: P[prov].local ? "" : val(el, "apiKey"),
      model: val(el, "model"), contextLength: Number(val(el, "contextLength")) || undefined });
    const bind = () => {
      const m = el.querySelector("[data-msg]");
      el.querySelectorAll("[name=prov]").forEach((r) => r.onchange = () => { prov = val(el, "prov"); tested = false; draw(); });
      el.querySelectorAll("[data-link]").forEach((a) => a.onclick = (e) => { e.preventDefault(); openUrl(a.dataset.link); });
      const adv = el.querySelector("[data-show-adv]");
      if (adv) adv.onclick = (e) => { e.preventDefault(); el.querySelectorAll("[data-adv]").forEach((x) => { x.hidden = false; }); adv.remove(); };
      // Test as soon as a key is pasted: one less button to find.
      const keyBox = el.querySelector("[name=apiKey]");
      keyBox.addEventListener("paste", () => setTimeout(() => { if (keyBox.value.trim().length > 20) el.querySelector("[data-test]").click(); }, 50));
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
  function resumes(el, cfg, onImported, { withGithub = true } = {}) {
    let files = [];
    el.innerHTML = `<div class="form">
      <div class="drop" data-drop>${icon("upload")}<div style="margin-top:8px"><b>Drop your resumes here</b> or click to choose</div>
        <small>PDF or Word (.docx). Several versions of your resume give the app more approved pieces to pick from.</small>
        <input type="file" accept=".pdf,.docx" multiple hidden></div>
      <div data-files class="sub-list"></div>
      <details class="more" data-builder><summary><b>I don't have a resume</b><span>Answer a few questions and the app writes one with you</span></summary><div data-creator style="padding:4px 16px 16px"></div></details>
      <details class="more" ${withGithub ? "" : "hidden"}><summary><b>Add projects from my GitHub</b><span>The app reads your public projects and writes lines about them</span></summary><div data-github style="padding:4px 16px 16px"></div></details>
      <details class="more"><summary><b>Paste your resume as text</b><span>If your file won't upload</span></summary><div class="fld" style="margin-top:10px"><textarea name="text" rows="8" placeholder="Paste the full text of your resume"></textarea></div></details>
      <div class="row-actions"><button type="button" class="btn primary" data-go>${icon("bolt")}Read my resume${cfg.profile ? " again" : ""}</button>
        <label class="check" ${cfg.profile ? "" : "hidden"}><input type="checkbox" name="merge" checked>Add to what I already approved</label>
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
    creator(el.querySelector("[data-creator]"), cfg, () => onImported && setTimeout(() => onImported(cfg.profile), 2500), { offerFill: false });
    if (withGithub) github(el.querySelector("[data-github]"), cfg);
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

  // ---------- "Help me remember": yes/no questions from what people in that job usually do ----------
  // job() returns { title, employer, daily, proud, tools } or { entryId }. Returns { confirmed() }.
  function recallBox(host, job) {
    let items = [], answers = {};
    host.innerHTML = `<button type="button" class="btn sm" data-recall>${icon("bolt")}Help me remember what I did</button><div data-rlist></div>`;
    const list = host.querySelector("[data-rlist]");
    const draw = (occupation) => {
      list.innerHTML = `<div class="recall"><div class="hint" style="margin-bottom:8px">Things people in this kind of job${occupation ? ` (${esc(occupation)})` : ""} often do. Say <b>Yes</b> only to what you really did; skip the rest. Yes answers become resume lines you check before they're used.</div>
        ${items.map((it, i) => `<div class="recall-item" data-i="${i}"><div class="recall-q">${esc(it.q)}${it.from === "ai" ? ` <span class="pill" title="Suggested by the AI for this kind of workplace">idea</span>` : ""}</div>
          <div class="row-actions"><button type="button" class="btn sm ${answers[i] && answers[i].yes ? "primary" : ""}" data-yes>Yes</button><button type="button" class="btn sm ghost ${answers[i] && answers[i].yes === false ? "on" : ""}" data-no>No</button>
          ${answers[i] && answers[i].yes ? `<input class="inp" data-detail placeholder="How many or how often? (optional, only if you know)" value="${esc(answers[i].detail || "")}" style="flex:1;min-width:220px">` : ""}</div></div>`).join("")}
        <small class="hint">Questions based on the U.S. Department of Labor's O*NET task lists (CC BY 4.0).</small></div>`;
      list.querySelectorAll(".recall-item").forEach((row) => {
        const i = Number(row.dataset.i);
        row.querySelector("[data-yes]").onclick = () => { answers[i] = { ...(answers[i] || {}), yes: true }; draw(occupation); const d = list.querySelector(`[data-i="${i}"] [data-detail]`); if (d) d.focus(); };
        row.querySelector("[data-no]").onclick = () => { answers[i] = { yes: false }; draw(occupation); };
        const d = row.querySelector("[data-detail]"); if (d) d.oninput = () => { answers[i].detail = d.value; };
      });
    };
    host.querySelector("[data-recall]").onclick = async (e) => {
      const btn = e.currentTarget, j = job();
      if (!j.entryId && !j.title) return msg(list, "err", "Type the job title first.");
      btn.disabled = true;
      msg(list, "info", "Looking up what people in this job usually do...");
      const r = await api("/api/resume/recall", { job: j });
      btn.disabled = false;
      if (r.error) return msg(list, "err", r.error);
      items = r.items; answers = {};
      if (!items.length) return msg(list, "info", "Couldn't find this kind of job in the task lists. Describe what you did in your own words instead.");
      btn.textContent = "Ask me again";
      draw(r.occupation);
    };
    return { confirmed: () => items.map((it, i) => (answers[i] && answers[i].yes ? { q: it.q, task: it.task, detail: String(answers[i].detail || "").trim() } : null)).filter(Boolean) };
  }

  // ---------- Projects from GitHub: pick public repositories, say how each was built ----------
  function github(el, cfg, onDone) {
    const a = cfg.answers || {};
    const user0 = String(a.github || "").replace(/^https?:\/\/(www\.)?github\.com\//i, "").split(/[/?#]/)[0];
    el.innerHTML = `<div class="form">
      <p class="hint" style="margin:0">The app looks at your public GitHub projects and writes resume lines from what each project's own description says. It can't tell from GitHub how a project was made, so you say that for each one. Nothing is used until you approve it.</p>
      <div class="row-actions">${fld("Your GitHub username", inp("gh_user", user0, 'placeholder="e.g. jordan-lee" autocomplete="off"'))}
        <button type="button" class="btn" data-gh-look style="align-self:end">${icon("search")}Look up my projects</button></div>
      <div data-gh-list></div><div data-gh-msg></div></div>`;
    const list = el.querySelector("[data-gh-list]"), m = el.querySelector("[data-gh-msg]");
    const ROLES = [["me", "I built it"], ["ai", "Mostly with AI coding tools"], ["team", "With other people"]];
    let user = "";
    el.querySelector("[data-gh-look]").onclick = async (e) => {
      const btn = e.currentTarget;
      user = val(el, "gh_user");
      if (!user) return msg(m, "err", "Type your GitHub username first.");
      btn.disabled = true; list.innerHTML = "";
      msg(m, "info", "Looking up your projects on GitHub...");
      const r = await api(`/api/github/repos?user=${encodeURIComponent(user)}`);
      btn.disabled = false;
      if (r.error) return msg(m, "err", r.error);
      msg(m, "", "");
      user = r.user;
      if (!r.repos.length) return msg(m, "info", `${r.user} has no public projects yet.`);
      list.innerHTML = `<div class="hint" style="margin:6px 0">Tick the projects to put on your resume (up to 8). The best ones are ticked already. Then say how each was built.</div>
        <div class="sub-list">${r.repos.slice(0, 40).map((x, i) => `<div class="sub-item gh-repo" data-repo="${esc(x.name)}">
          <label class="check"><input type="checkbox" data-pick ${r.suggested.includes(x.name) ? "checked" : ""}><b>${esc(x.name)}</b>
            <span class="muted meta">${[x.language, x.stars ? `${x.stars} star${x.stars === 1 ? "" : "s"}` : "", x.fork ? "copy of someone else’s project" : "", x.archived ? "archived" : ""].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join("")}</span></label>
          ${x.description ? `<div class="muted" style="margin:2px 0 4px 26px">${esc(x.description)}</div>` : ""}
          <div style="margin-left:26px">${radios(`gh_role_${i}`, "me", ROLES)}</div></div>`).join("")}</div>
        <div class="row-actions" style="margin-top:10px"><button type="button" class="btn primary" data-gh-add>${icon("plus")}Add the ticked projects</button></div><div data-gh-out></div>`;
      list.querySelector("[data-gh-add]").onclick = async (ev) => {
        const out = list.querySelector("[data-gh-out]");
        const repos = [...list.querySelectorAll("[data-repo]")].filter((row) => row.querySelector("[data-pick]").checked)
          .map((row) => ({ name: row.dataset.repo, role: (row.querySelector("input[type=radio]:checked") || {}).value || "me" }));
        if (!repos.length) return msg(out, "err", "Tick at least one project.");
        if (repos.length > 8) return msg(out, "err", "Pick up to 8 projects. A resume has room for two or three.");
        const btn = ev.currentTarget;
        btn.disabled = true;
        msg(out, "info", "Reading each project and writing lines about it. This takes up to a minute...");
        const res = await api("/api/github/import", { user, repos });
        btn.disabled = false;
        if (res.error) return msg(out, "err", res.error);
        cfg.profile = res.profile; cfg.answers = res.answers;
        const n = res.added.reduce((k, x) => k + x.lines, 0);
        out.innerHTML = `<div class="msg ok">Added ${res.added.length} project${res.added.length === 1 ? "" : "s"} with ${n} line${n === 1 ? "" : "s"}, waiting for your approval.${res.rejected.length ? ` ${res.rejected.length} line${res.rejected.length === 1 ? " was" : "s were"} left out because ${res.rejected.length === 1 ? "it" : "they"} said more than the project does.` : ""}</div>
          ${res.questions.length ? `<div class="msg info" style="margin-top:8px"><b>To make them stronger</b>, think about: ${res.questions.map((q) => esc(q.question)).join(" ")} You can add the answer to a line when you review it.</div>` : ""}`;
        onDone && onDone(res);
      };
    };
  }

  // ---------- Resume creator: a short interview, then a resume from the answers ----------
  function creator(el, cfg, onDone, { offerFill = true } = {}) {
    const jobCard = (n) => `<div class="sub-item" data-cjob>
      <div class="row-actions" style="justify-content:space-between"><b>Job ${n}</b><button type="button" class="btn ghost sm" data-rm-cjob>${icon("trash")}Remove</button></div>
      <div class="form-row">${fld("Job title", inp("c_title", "", 'placeholder="e.g. Cashier, Line cook, Office assistant"'))}${fld("Employer", inp("c_employer", "", 'placeholder="e.g. Target"'))}${fld("City", inp("c_location", "", 'placeholder="e.g. Austin, TX"'))}</div>
      <div class="form-row">${fld("Started", inp("c_start", "", 'placeholder="e.g. Jun 2023"'))}${fld("Ended", inp("c_end", "", 'placeholder="e.g. Aug 2024"'))}
        <div class="fld" style="align-self:end"><label class="check"><input type="checkbox" name="c_current">I work here now</label></div></div>
      ${fld("What did you do on a normal day?", `<textarea name="c_daily" rows="3" placeholder="In your own words, e.g. ran the register, stocked shelves, opened and closed the store, answered phones"></textarea>`)}
      ${fld("What are you proud of, or what went well?", `<textarea name="c_proud" rows="2" placeholder="e.g. trained 3 new people, got employee of the month, never had my cash drawer come up short"></textarea>`, "Optional, but this is what makes a resume stand out.")}
      <div class="form-row">${fld("Any numbers you know?", inp("c_numbers", "", 'placeholder="e.g. about 150 customers a day, team of 6, $3,000 a shift"'), "Only numbers you're sure of. Rough is fine (about 100).")}
        ${fld("Tools, machines or software", inp("c_tools", "", 'placeholder="e.g. cash register, forklift, Excel, Square"'))}</div>
      <div data-recall-host></div></div>`;
    const schoolCard = () => `<div class="form-row" data-cschool>${fld("School or training", inp("c_school", "", 'placeholder="e.g. Lincoln High School, Austin Community College"'))}
      ${fld("What you earned", inp("c_earned", "", 'placeholder="e.g. Diploma, GED, Associate degree, CNA certificate"'))}${fld("Year", inp("c_year", "", 'placeholder="e.g. 2022, or Expected 2027"'))}</div>`;
    el.innerHTML = `<div class="form">
      <p class="hint" style="margin:0">Answer in your own words; spelling and wording don't matter. The AI turns your answers into resume lines the way recruiters like them: short, starting with an action, showing results. It never adds anything you didn't say, and you check every line before it's used.</p>
      <div class="section-t">1. The job you want next</div>
      ${fld("What kind of job are you looking for?", inp("c_target", (cfg.prefs && (cfg.prefs.titles || [])[0]) || "", 'placeholder="e.g. Retail associate, Warehouse worker, Medical assistant"'))}
      <div class="section-t">2. Your jobs, newest first</div>
      <p class="hint" style="margin:-4px 0 0">Include part-time jobs, family businesses, gig work and volunteering. They all count.</p>
      <div class="sub-list" data-cjobs>${jobCard(1)}</div>
      <div><button type="button" class="btn sm" data-add-cjob>${icon("plus")}Add another job</button></div>
      <div class="section-t">3. School and training</div>
      <div class="sub-list" data-cschools>${schoolCard()}</div>
      <div><button type="button" class="btn sm" data-add-cschool>${icon("plus")}Add another</button></div>
      <div class="section-t">4. Skills and the rest</div>
      <div class="form-row">${fld("Certifications and licenses", inp("c_certs", "", 'placeholder="e.g. Food Handler, forklift, CPR, CDL"'))}${fld("Languages", inp("c_langs", "", 'placeholder="e.g. English, Spanish"'))}</div>
      ${fld("Skills", inp("c_skills", "", 'placeholder="e.g. cash handling, customer service, Excel, inventory"'))}
      ${fld("Anything else? (optional)", inp("c_summary", "", 'placeholder="e.g. Reliable, available weekends, love working with people"'), "Used for the short summary at the top.")}
      <label class="check" ${cfg.profile ? "" : "hidden"}><input type="checkbox" name="c_merge" ${cfg.profile ? "" : "checked"}>Add to my current resume instead of starting a new one</label>
      <div class="row-actions"><button type="button" class="btn primary" data-cgo>${icon("bolt")}Write my resume</button></div>
      <div data-cmsg></div></div>`;
    const m = el.querySelector("[data-cmsg]");
    // Each job card gets its own "Help me remember" box.
    const boxes = new WeakMap();
    const attach = () => el.querySelectorAll("[data-cjob]").forEach((c) => {
      if (boxes.has(c)) return;
      boxes.set(c, recallBox(c.querySelector("[data-recall-host]"), () => ({ title: val(c, "c_title"), employer: val(c, "c_employer"),
        daily: c.querySelector("[name=c_daily]").value.trim(), proud: c.querySelector("[name=c_proud]").value.trim(), tools: val(c, "c_tools") })));
    });
    attach();
    const renumber = () => el.querySelectorAll("[data-cjob]").forEach((c, i) => { c.querySelector("b").textContent = `Job ${i + 1}`; });
    const bind = () => el.querySelectorAll("[data-rm-cjob]").forEach((b) => b.onclick = () => { if (el.querySelectorAll("[data-cjob]").length > 1) { b.closest("[data-cjob]").remove(); renumber(); } });
    bind();
    el.querySelector("[data-add-cjob]").onclick = () => { el.querySelector("[data-cjobs]").insertAdjacentHTML("beforeend", jobCard(el.querySelectorAll("[data-cjob]").length + 1)); bind(); attach(); };
    el.querySelector("[data-add-cschool]").onclick = () => el.querySelector("[data-cschools]").insertAdjacentHTML("beforeend", schoolCard());
    el.querySelector("[data-cgo]").onclick = async () => {
      const jobs = [...el.querySelectorAll("[data-cjob]")].map((c) => ({ title: val(c, "c_title"), employer: val(c, "c_employer"), location: val(c, "c_location"), start: val(c, "c_start"),
        end: val(c, "c_end"), current: val(c, "c_current"), daily: c.querySelector("[name=c_daily]").value.trim(), proud: c.querySelector("[name=c_proud]").value.trim(), numbers: val(c, "c_numbers"), tools: val(c, "c_tools"),
        confirmed: boxes.has(c) ? boxes.get(c).confirmed() : [] }))
        .filter((j) => j.title || j.employer);
      const education = [...el.querySelectorAll("[data-cschool]")].map((c) => ({ school: val(c, "c_school"), earned: val(c, "c_earned"), year: val(c, "c_year") })).filter((e) => e.school);
      if (!jobs.length && !education.length) return msg(m, "err", "Add at least one job (or a school, if you haven't worked yet).");
      const thin = jobs.find((j) => !j.daily && !j.confirmed.length);
      if (thin) return msg(m, "err", `Tell us what you did at ${thin.title || thin.employer} on a normal day, or use "Help me remember what I did". A few words is enough.`);
      const interview = { target: val(el, "c_target"), jobs, education, certifications: val(el, "c_certs"), languages: val(el, "c_langs"), skills: val(el, "c_skills"), summary: val(el, "c_summary") };
      const btn = el.querySelector("[data-cgo]");
      btn.disabled = true;
      msg(m, "info", "Writing your resume from your answers, then checking every line against what you said. This usually takes 2 to 7 minutes; you can leave this window open and wait.");
      const r = await api("/api/resume/create", { interview, merge: val(el, "c_merge") });
      btn.disabled = false;
      if (r.error) return msg(m, "err", r.error);
      cfg.profile = r.profile; cfg.answers = r.answers;
      const lines = r.profile.experience.reduce((n, e) => n + e.bullets.length, 0);
      m.innerHTML = `<div class="msg ok">Done: ${lines} lines from your answers. Check each one next.${r.rejected.length ? ` ${r.rejected.length} suggestion${r.rejected.length === 1 ? " was" : "s were"} left out because ${r.rejected.length === 1 ? "it" : "they"} added things you didn't say.` : ""}</div>
        ${r.questions.length ? `<div class="msg info" style="margin-top:8px"><b>To make it stronger later</b>, think about: ${r.questions.map((q) => esc(q.question)).join(" ")} Then use <b>Check &amp; improve</b> on the Resume page.</div>` : ""}
        ${offerFill ? `<div class="sub-item" style="margin-top:8px"><b>Want a fuller page?</b> <span class="muted">A few questions about other work, training, records and school that people usually leave out.</span>
          <div class="row-actions"><button type="button" class="btn sm" data-cfill>${icon("plus")}Fill out my page</button></div><div data-cfill-host></div></div>` : ""}`;
      if (offerFill) m.querySelector("[data-cfill]").onclick = (ev) => { ev.currentTarget.hidden = true; fillPage(m.querySelector("[data-cfill-host]"), cfg, () => onDone && onDone({ ...r, profile: cfg.profile })); };
      onDone && onDone(r);
    };
    return { save: async () => (cfg.profile ? null : "Write your resume first.") };
  }

  // ---------- Fill out my page: the real things people leave out, asked for and turned into pieces ----------
  async function fillPage(el, cfg, onChange) {
    msg(el, "info", "Getting your questions ready...");
    const q = await api("/api/resume/fill/questions", {});
    if (q.error) return msg(el, "err", q.error);
    const workCard = (kind) => `<div class="sub-item" data-fwork="${kind}">
      <div class="form-row">${fld(kind === "vol" ? "What you did (role)" : "Job title", inp("f_title", "", `placeholder="${kind === "vol" ? "e.g. Youth soccer coach, Food bank volunteer" : "e.g. Delivery driver, Seasonal warehouse"}"`))}
        ${fld(kind === "vol" ? "Where" : "Employer", inp("f_employer", "", kind === "vol" ? 'placeholder="e.g. Sacramento Food Bank, a church, Little League (or leave empty)"' : 'placeholder="e.g. DoorDash, family business"'))}</div>
      <div class="form-row">${fld("Started", inp("f_start", "", 'placeholder="e.g. 2019"'))}${fld("Ended", inp("f_end", "", 'placeholder="e.g. 2020"'))}
        <div class="fld" style="align-self:end"><label class="check"><input type="checkbox" name="f_current">Still doing it</label></div></div>
      ${fld("What did you do?", `<textarea name="f_daily" rows="2" placeholder="In your own words, with any numbers you know"></textarea>`)}
      ${kind === "vol" ? "" : fld("Tools, machines or software", inp("f_tools", "", 'placeholder="e.g. hand truck, delivery app"'))}</div>`;
    const certRow = (name = "") => `<div class="form-row" data-fcert>${fld("License or training", inp("f_cname", name, 'placeholder="e.g. OSHA 10, First aid / CPR, Flagger"'))}
      ${fld("Who issued it", inp("f_issuer", "", 'placeholder="e.g. WreckMaster, Red Cross, state DMV"'))}${fld("Year", inp("f_year", "", 'placeholder="e.g. 2022"'))}</div>`;
    const schoolRow = () => `<div class="form-row" data-fschool>${fld("School, class or course", inp("f_school", "", 'placeholder="e.g. truck driving school, shop class, online course"'))}
      ${fld("What you earned or studied", inp("f_earned", "", 'placeholder="e.g. Certificate, CompTIA A+ study"'))}${fld("Year", inp("f_syear", "", 'placeholder="e.g. 2020, or In progress"'))}</div>`;
    el.innerHTML = `<div class="form fill">
      <p class="hint" style="margin:0">Answer only what is true; skip the rest. Each answer becomes a resume piece that waits for your approval, and nothing is added that you didn't say.</p>
      ${q.numbers.length ? `<div class="section-t">The numbers behind your lines</div><p class="hint" style="margin:-4px 0 0">A recruiter looks for how many and how often. Only answer if you know (rough is fine: "about 20").</p>
        ${q.numbers.map((x, i) => `<div class="sub-item" data-fnum="${i}"><div class="muted" style="font-size:12px">${esc(x.job)}</div><div>${esc(x.original)}</div>${fld(esc(x.question), inp("f_num", ""))}</div>`).join("")}` : ""}
      <div class="section-t">Other work, even small</div><p class="hint" style="margin:-4px 0 0">${esc(q.prompts.jobs)}</p>
      <div class="sub-list" data-fjobs>${workCard("job")}</div><div><button type="button" class="btn sm" data-fadd="job">${icon("plus")}Add another job</button></div>
      <div class="section-t">Licenses and training</div><p class="hint" style="margin:-4px 0 0">${esc(q.prompts.certs)}</p>
      <div class="sub-list" data-fcerts>${q.certs.map(certRow).join("")}${certRow()}</div><div><button type="button" class="btn sm" data-fadd="cert">${icon("plus")}Add another</button></div>
      ${q.jobs.length ? `<div class="section-t">Records and recognition</div><p class="hint" style="margin:-4px 0 0">${esc(q.prompts.records)}</p>
        ${q.jobs.map((j) => fld(esc(`${j.title}${j.org ? ", " + j.org : ""}`), inp(`f_rec_${j.id}`, "", 'placeholder="e.g. 3 years with no damage claims, employee of the month 2023"'))).join("")}` : ""}
      <div class="section-t">Volunteering and outside work</div><p class="hint" style="margin:-4px 0 0">${esc(q.prompts.volunteer)}</p>
      <div class="sub-list" data-fvols>${workCard("vol")}</div>
      <div class="section-t">School and courses</div><p class="hint" style="margin:-4px 0 0">${esc(q.prompts.school)}${(q.schools || []).length ? ` Already on your resume: ${q.schools.map(esc).join("; ")}.` : ""}</p>
      <div class="sub-list" data-fschools>${schoolRow()}</div>
      <div class="row-actions"><button type="button" class="btn primary" data-fgo>${icon("check")}Add these to my resume</button></div>
      <div data-fmsg></div></div>`;
    el.querySelectorAll("[data-fadd]").forEach((b) => b.onclick = () => {
      const host = el.querySelector(b.dataset.fadd === "job" ? "[data-fjobs]" : "[data-fcerts]");
      host.insertAdjacentHTML("beforeend", b.dataset.fadd === "job" ? workCard("job") : certRow());
    });
    const work = (kind) => [...el.querySelectorAll(`[data-fwork="${kind}"]`)].map((c) => ({ title: val(c, "f_title"), employer: val(c, "f_employer"), start: val(c, "f_start"),
      end: val(c, "f_end"), current: val(c, "f_current"), daily: c.querySelector("[name=f_daily]").value.trim(), tools: val(c, "f_tools") || "" })).filter((j) => j.title || j.employer);
    el.querySelector("[data-fgo]").onclick = async (e) => {
      const btn = e.currentTarget, m = el.querySelector("[data-fmsg]");
      const input = { jobs: work("job"), volunteer: work("vol"),
        certs: [...el.querySelectorAll("[data-fcert]")].map((c) => ({ name: val(c, "f_cname"), issuer: val(c, "f_issuer"), year: val(c, "f_year") })).filter((c) => c.name && (c.issuer || c.year || !q.certs.includes(c.name))),
        records: q.jobs.map((j) => ({ id: j.id, text: val(el, `f_rec_${j.id}`) })).filter((x) => x.text),
        school: [...el.querySelectorAll("[data-fschool]")].map((c) => ({ school: val(c, "f_school"), earned: val(c, "f_earned"), year: val(c, "f_syear") })).filter((x) => x.school),
        numbers: q.numbers.map((x, i) => ({ ...x, answer: val(el.querySelector(`[data-fnum="${i}"]`), "f_num") })).filter((x) => x.answer) };
      const thin = [...input.jobs, ...input.volunteer].find((j) => !j.daily);
      if (thin) return msg(m, "err", `Say a few words about what you did at ${thin.title || thin.employer}.`);
      if (!Object.values(input).some((x) => x.length)) return msg(m, "err", "Answer at least one question first.");
      btn.disabled = true; msg(m, "info", "Turning your answers into resume pieces and checking each one. This takes a minute or two...");
      const r = await api("/api/resume/fill/apply", { input });
      btn.disabled = false;
      if (r.error) return msg(m, "err", r.error);
      cfg.profile = r.profile;
      m.innerHTML = `<div class="msg ok">Added ${r.added.length} piece${r.added.length === 1 ? "" : "s"}. Approve ${r.added.length === 1 ? "it" : "them"} under "All your resume pieces" to put ${r.added.length === 1 ? "it" : "them"} on your resume.${r.rejected.length ? ` ${r.rejected.length} wording${r.rejected.length === 1 ? " was" : "s were"} left out because ${r.rejected.length === 1 ? "it" : "they"} added things you didn't say.` : ""}</div>
        ${r.added.length ? `<ul class="bul" style="margin-top:6px">${r.added.map((x) => `<li>${esc(x.title)}</li>`).join("")}</ul>` : ""}
        ${r.rejected.length ? `<details class="more" style="margin-top:6px"><summary>Left out (${r.rejected.length})</summary><ul class="bul">${r.rejected.slice(0, 8).map((x) => `<li>${esc(x.text)} <span class="muted">${esc((x.why || []).join("; "))}</span></li>`).join("")}</ul></details>` : ""}`;
      onChange && onChange(r);
    };
  }

  // ---------- Check & improve: the recruiter checklist and suggested rewrites ----------
  function studio(el, cfg, onChange) {
    let suggestions = [];
    const levelIcon = { good: `<span class="ck good">✓</span>`, fix: `<span class="ck fix">!</span>`, tip: `<span class="ck tip">i</span>` };
    el.innerHTML = `<div class="form">
      <div class="row-actions">
        <button type="button" class="btn primary" data-improve-all>${icon("bolt")}Suggest improvements for every line</button>
        <button type="button" class="btn" data-download>${icon("file")}Download my resume (PDF)</button>
        <button type="button" class="btn ghost" data-preview>${icon("eye")}Preview</button>
      </div>
      <div data-smsg></div>
      <div class="section-t">A recruiter's read</div>
      <p class="hint" style="margin:-4px 0 0">The AI reads your resume the way a recruiter skims one, and says what stands out and what is weak, line by line. It never adds facts.</p>
      <div class="row-actions"><select class="inp" data-rv-base style="max-width:18rem"></select><button type="button" class="btn" data-review>${icon("eye")}Read it like a recruiter</button></div>
      <div data-rv-out></div>
      <div class="section-t">A version for each kind of job</div>
      <p class="hint" style="margin:-4px 0 0">Applying to different kinds of jobs (driving and IT support, say)? Make a version for each: your true lines, chosen and worded for that field, with a headline and summary for it. New wording waits for your approval.</p>
      <div class="row-actions"><input class="inp" data-vt placeholder="e.g. CDL driving, IT support, Warehouse" style="max-width:18rem" list="vt-list"><datalist id="vt-list">${((cfg.prefs && cfg.prefs.titles) || []).map((t) => `<option value="${esc(t)}">`).join("")}</datalist>
        <button type="button" class="btn" data-version>${icon("plus")}Make this version</button></div>
      <div data-vt-out></div>
      <div class="section-t">What recruiters will notice</div>
      <div data-checks><div class="muted">Checking...</div></div>
      <div class="section-t">Fill out my page</div>
      <p class="hint" style="margin:-4px 0 0">A short resume looks thin to a recruiter. A few questions about what people usually leave out: other work, training with its year, records and recognition, volunteering, school, and the numbers behind your lines.</p>
      <div class="row-actions"><button type="button" class="btn" data-fill-open>${icon("plus")}Fill out my page</button></div>
      <div data-fill></div>
      <div class="section-t">Remember more</div>
      <p class="hint" style="margin:-4px 0 0">Most people forget things they did. Pick a job and answer a few yes/no questions about what people in that job usually do.</p>
      <div class="sub-list" data-remember></div>
      <div data-sugg-wrap hidden><div class="section-t">Suggested improvements</div>
        <p class="hint" style="margin:-4px 0 8px">Every suggestion says the same facts you gave, worded the way recruiters like. Anything that added a number or claim you didn't give was left out; you'll see a question instead.</p>
        <div class="sub-list" data-sugg></div></div></div>`;
    const sm = el.querySelector("[data-smsg]");
    // Layouts to read: every approved one, by what it is for.
    const bases = ((cfg.profile && cfg.profile.bases) || []).filter((b) => b.approved);
    el.querySelector("[data-rv-base]").innerHTML = bases.length ? bases.map((b) => `<option value="${esc(b.id)}">${esc(b.description || b.id)}</option>`).join("") : `<option value="">Approve a layout first</option>`;
    el.querySelector("[data-review]").onclick = async (e) => {
      const btn = e.currentTarget, out = el.querySelector("[data-rv-out]");
      btn.disabled = true; msg(out, "info", "Reading your resume the way a recruiter would...");
      const r = await api("/api/resume/review", { base: el.querySelector("[data-rv-base]").value });
      btn.disabled = false;
      if (r.error) return msg(out, "err", r.error);
      const where = (path) => { if (["headline", "summary", "skills", "layout"].includes(path)) return path === "layout" ? "Overall" : path.charAt(0).toUpperCase() + path.slice(1);
        const [k, eid, bid] = path.split("."); const e2 = ((cfg.profile[k] || []).find((x) => x.id === eid)) || {}; const b2 = (e2.bullets || []).find((x) => x.id === bid); return b2 ? `${e2.title}: "${b2.text}"` : e2.title || path; };
      out.innerHTML = `<div class="review"><div class="review-score"><span class="fig">${r.score}</span><span>/10</span></div><div><b>${esc(r.verdict)}</b>
          ${r.strengths.length ? `<ul class="bul" style="margin-top:6px">${r.strengths.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div></div>
        ${r.items.length ? `<div class="checklist">${r.items.map((x) => `<div class="check-item"><span class="ck fix">!</span><div style="flex:1"><b>${esc(where(x.path))}</b><div class="muted">${esc(x.problem)}</div><div>${esc(x.fix)}</div></div>
          ${/^(experience|projects)\./.test(x.path) ? `<button type="button" class="btn sm" data-rv-fix="${esc(x.path)}">Improve this</button>` : ""}</div>`).join("")}</div>` : ""}`;
      out.querySelectorAll("[data-rv-fix]").forEach((b) => b.onclick = () => improve([b.dataset.rvFix]));
    };
    el.querySelector("[data-version]").onclick = async (e) => {
      const btn = e.currentTarget, out = el.querySelector("[data-vt-out]");
      const target = el.querySelector("[data-vt]").value.trim();
      if (!target) return msg(out, "err", "Type the kind of job first.");
      btn.disabled = true; msg(out, "info", `Choosing and wording your lines for ${target} jobs...`);
      const r = await api("/api/resume/version", { target });
      btn.disabled = false;
      if (r.error) return msg(out, "err", r.error);
      cfg.profile = r.profile;
      out.innerHTML = `<div class="msg ok">Made a ${esc(target)} version${r.newLines ? ` with ${r.newLines} new piece${r.newLines === 1 ? "" : "s"} of wording` : ""}. Approve it under "All your resume pieces": the layout "${esc(target)} jobs" and anything new in it.${r.rejected.length ? ` ${r.rejected.length} rewording${r.rejected.length === 1 ? " was" : "s were"} left out because ${r.rejected.length === 1 ? "it" : "they"} added things your lines don't say.` : ""}</div>
        ${r.gaps.length ? `<div class="sub-item" style="margin-top:8px"><b>What ${esc(target)} job ads often ask for that your resume doesn't show</b><ul class="bul">${r.gaps.map((g) => `<li><b>${esc(g.need)}</b> <span>${esc(g.how)}</span></li>`).join("")}</ul>
          <small class="hint">Advice only: none of this goes on your resume until you have it and add it yourself.</small></div>` : ""}`;
      onChange && onChange();
    };
    el.querySelector("[data-fill-open]").onclick = (e) => { e.currentTarget.hidden = true; fillPage(el.querySelector("[data-fill]"), cfg, () => { drawChecks(); onChange && onChange(); }); };
    const drawChecks = async () => {
      const r = await api("/api/resume/check", {});
      const host = el.querySelector("[data-checks]");
      if (r.error) { host.innerHTML = `<div class="msg info">${esc(r.error)}</div>`; return; }
      const order = { fix: 0, tip: 1, good: 2 };
      host.innerHTML = `<div class="checklist">${r.checks.sort((a, b) => order[a.level] - order[b.level]).map((c, i) => `<div class="check-item ${c.level}">${levelIcon[c.level]}
        <div style="flex:1"><b>${esc(c.title)}</b>${c.detail ? `<div class="muted">${esc(c.detail)}</div>` : ""}
        ${c.items.length ? `<ul class="bul" style="margin-top:6px">${c.items.slice(0, 5).map((x) => `<li>${esc(x.text)} <span>${esc(x.why || "")}</span></li>`).join("")}</ul>` : ""}</div>
        ${c.items.some((x) => x.path && x.path.split(".").length >= 2 && !/^experience\.[^.]+$/.test(x.path)) && c.level !== "good" ? `<button type="button" class="btn sm" data-fix="${i}">Improve these</button>` : ""}</div>`).join("")}</div>`;
      host.querySelectorAll("[data-fix]").forEach((b) => b.onclick = () => improve(r.checks[Number(b.dataset.fix)].items.map((x) => x.path)));
    };
    const drawSugg = () => {
      const wrap = el.querySelector("[data-sugg-wrap]"), host = el.querySelector("[data-sugg]");
      wrap.hidden = false;
      if (!suggestions.length) { host.innerHTML = `<div class="msg ok">Nothing to change: these lines already read the way recruiters like.</div>`; return; }
      host.innerHTML = suggestions.map((s, i) => `<div class="sub-item sugg" data-i="${i}">
        <div class="muted" style="font-size:12px">${esc(s.kind === "summary" ? "Summary" : s.job || "")}</div>
        <div><span class="pill">Now</span> ${esc(s.original)}</div>
        ${s.text ? `<div class="fld"><span><span class="pill ok">Suggested</span> ${esc(s.why || "")}</span><textarea name="t" rows="2">${esc(s.text)}</textarea></div>
          <div class="row-actions"><button type="button" class="btn sm primary" data-use>${icon("check")}Use this</button><button type="button" class="btn sm" data-both>Keep both</button><button type="button" class="btn sm ghost" data-no>No thanks</button></div>` : ""}
        ${s.question ? `<div class="fld"><span>${icon("bolt")} ${esc(s.question)}</span><div class="row-actions"><input class="inp" name="a" placeholder="Your answer (only if you know it)" style="flex:1;min-width:220px">
          <button type="button" class="btn sm" data-answer>Rewrite with my answer</button>${s.text ? "" : `<button type="button" class="btn sm ghost" data-no>Skip</button>`}</div></div>` : ""}
        <div data-m></div></div>`).join("");
      host.querySelectorAll(".sugg").forEach((card) => {
        const i = Number(card.dataset.i), s = suggestions[i], cm = card.querySelector("[data-m]");
        const apply = async (mode) => {
          const text = card.querySelector("[name=t]").value.trim();
          const r = await api("/api/resume/apply", { path: s.path, text, mode });
          if (r.error) return msg(cm, "err", r.error);
          cfg.profile = r.profile;
          suggestions.splice(i, 1); drawSugg(); drawChecks(); onChange && onChange();
        };
        const u = card.querySelector("[data-use]"); if (u) u.onclick = () => apply("replace");
        const b = card.querySelector("[data-both]"); if (b) b.onclick = () => apply("add");
        card.querySelectorAll("[data-no]").forEach((n) => n.onclick = () => { suggestions.splice(i, 1); drawSugg(); });
        const a = card.querySelector("[data-answer]");
        if (a) a.onclick = async () => {
          msg(cm, "info", "Rewriting...");
          const r = await api("/api/resume/answer", { path: s.path, original: s.original, question: s.question, answer: val(card, "a") });
          if (r.error) return msg(cm, "err", r.error);
          suggestions[i] = { ...s, ...r, question: "" };
          drawSugg();
        };
      });
    };
    const improve = async (paths) => {
      msg(sm, "info", "Reading your resume like a recruiter would. This takes up to a minute...");
      const r = await api("/api/resume/improve", paths ? { paths } : {});
      if (r.error) return msg(sm, "err", r.error);
      msg(sm, "", "");
      suggestions = r.suggestions;
      drawSugg();
      el.querySelector("[data-sugg-wrap]").scrollIntoView({ behavior: "smooth", block: "start" });
    };
    el.querySelector("[data-improve-all]").onclick = () => improve(null);
    const pdf = async () => { const r = await api("/api/profile/preview", {}); if (r.error) { msg(sm, "err", r.error); return null; } return r; };
    el.querySelector("[data-preview]").onclick = async () => { const r = await pdf(); if (r) window.open(r.url, "_blank"); };
    el.querySelector("[data-download]").onclick = async () => {
      const r = await pdf(); if (!r) return;
      const f = await window.ja.saveResume(r.file, r.fileName || "Resume.pdf");
      if (f) msg(sm, "ok", "Saved to " + f);
    };
    const drawRemember = () => {
      const host = el.querySelector("[data-remember]");
      const jobs = (cfg.profile.experience || []).filter((e) => e.title);
      host.innerHTML = jobs.length ? jobs.map((e) => `<div class="sub-item" data-entry="${esc(e.id)}"><b>${esc(e.title)}${e.org ? ", " + esc(e.org) : ""}</b><div data-box></div>
        <div class="row-actions"><button type="button" class="btn sm primary" data-add-recalled hidden>${icon("plus")}Add what I said yes to</button></div><div data-rm></div></div>`).join("")
        : `<div class="muted">Add a job first.</div>`;
      host.querySelectorAll("[data-entry]").forEach((row) => {
        const box = recallBox(row.querySelector("[data-box]"), () => ({ entryId: row.dataset.entry }));
        const addBtn = row.querySelector("[data-add-recalled]");
        row.querySelector("[data-box] [data-recall]").addEventListener("click", () => { addBtn.hidden = false; });
        addBtn.onclick = async () => {
          const rm = row.querySelector("[data-rm]");
          msg(rm, "info", "Writing lines from your answers...");
          const r = await api("/api/resume/recall/add", { entryId: row.dataset.entry, confirmed: box.confirmed() });
          if (r.error) return msg(rm, "err", r.error);
          cfg.profile = r.profile;
          msg(rm, "ok", `Added ${r.added} line${r.added === 1 ? "" : "s"}, waiting for your approval in "All your resume pieces".${r.rejected.length ? ` ${r.rejected.length} left out: they added things you didn't say.` : ""}`);
          onChange && onChange();
        };
      });
    };
    drawRemember();
    drawChecks();
    return { save: async () => null, refresh: drawChecks };
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
      <div>${opts.input ? `<input type="text" data-edit="${path}" value="${esc(text)}">` : `<textarea data-edit="${path}" rows="${Math.min(8, Math.max(1, Math.ceil(String(text).length / 72)))}">${esc(text)}</textarea>`}
        ${opts.source ? `<small class="hint" style="display:block;padding:0 8px">From your answer: "${esc(String(opts.source).slice(0, 160))}"</small>` : ""}
        ${opts.warning ? `<small class="warn-line">${icon("alert")} ${esc(opts.warning)}</small>` : ""}</div>
      <div style="display:flex;gap:4px">${opts.preview ? `<button type="button" class="btn ghost sm" data-preview="${esc(opts.preview)}" title="Preview this layout">${icon("eye")}</button>` : ""}
        <button type="button" class="btn ghost sm" data-del="${path}" title="Delete">${icon("trash")}</button></div></div>`;
    const group = (title, key, body, add) => `<div class="rv-group"><div class="rv-head">${title}<span class="right">
      ${add ? `<button type="button" class="btn ghost sm" data-add="${add}">${icon("plus")}Add</button>` : ""}
      <button type="button" class="btn sm" data-all="${key}">${icon("check")}Approve all</button></span></div>${body || `<div class="rv-item"><span></span><span class="muted">Nothing here.</span></div>`}</div>`;
    const draw = () => {
      const c = counts();
      let h = `<div class="banner blue"><div style="flex:1"><b>${c.ok} of ${c.n} pieces approved</b>Your resume is only ever made from pieces you approve here. Read each line, fix anything that isn't exactly true, delete what you'd never send, and tick the rest.</div>
        <div class="right"><button type="button" class="btn sm primary" data-approve-everything>${icon("check")}Everything is true: approve all</button></div></div><div data-held></div>`;
      h += group("Summaries", "summaries", arr(p.summaries).map((s, i) => item(`summaries.${i}.text`, s.text, s.approved, { warning: s.warning })).join(""), "summary");
      for (const [k, title] of [["experience", "Experience"], ["projects", "Projects"]]) {
        arr(p[k]).forEach((e, ei) => {
          const head = `<div class="rv-item"><span></span><div class="form-row">
            <input type="text" data-edit="${k}.${ei}.title" value="${esc(e.title)}" placeholder="Title">
            ${k === "experience" ? `<input type="text" data-edit="${k}.${ei}.org" value="${esc(e.org)}" placeholder="Employer">` : `<input type="text" data-edit="${k}.${ei}.link" value="${esc(e.link || "")}" placeholder="Link">`}
            <input type="text" data-edit="${k}.${ei}.dates" value="${esc(e.dates || "")}" placeholder="Dates"></div>
            <button type="button" class="btn ghost sm" data-del="${k}.${ei}" title="Delete this entry">${icon("trash")}</button></div>
            ${k === "projects" ? `<div class="rv-item"><span></span><label class="check"><input type="checkbox" data-flag="${k}.${ei}.aiBuilt" ${e.aiBuilt ? "checked" : ""}>Built mostly by AI coding agents (answers must say so, and never "I built it")</label><span></span></div>` : ""}`;
          h += group(`${title}: ${esc(e.title || "")}${e.org ? ", " + esc(e.org) : ""}`, `${k}.${ei}.bullets`, head + arr(e.bullets).map((b, bi) => item(`${k}.${ei}.bullets.${bi}.text`, b.text, b.approved, { source: b.source, warning: b.warning })).join(""), `bullet:${k}.${ei}`);
        });
      }
      h += group("Skills", "skills", arr(p.skills).map((s, i) => `<div class="rv-item ${s.approved ? "ok" : ""}"><input type="checkbox" class="approve" data-approve="skills.${i}.text" ${s.approved ? "checked" : ""}>
        <div class="form-row" style="grid-template-columns:200px 1fr"><input type="text" data-edit="skills.${i}.label" value="${esc(s.label)}"><input type="text" data-edit="skills.${i}.items" value="${esc(s.items)}"></div>${s.offPage ? `<small class="hint" style="grid-column:2/-1">Kept off the resume: recruiters skip general abilities like these. Your lines already show them.</small>` : ""}
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
      el.querySelectorAll("[data-edit]").forEach((e) => e.oninput = () => { const [o, k] = at(e.dataset.edit); o[k] = e.value; if (k === "text" && o.warning) delete o.warning; });
      el.querySelectorAll("[data-flag]").forEach((e) => e.onchange = () => { const [o, k] = at(e.dataset.flag); o[k] = e.checked; });
      el.querySelectorAll("[data-approve]").forEach((e) => e.onchange = () => { const [o] = at(e.dataset.approve); o.approved = e.checked; e.closest(".rv-item").classList.toggle("ok", e.checked); el.querySelector(".banner b").textContent = `${counts().ok} of ${counts().n} pieces approved`; });
      el.querySelectorAll("[data-del]").forEach((e) => e.onclick = () => { const parts = e.dataset.del.split("."); const idx = Number(parts.pop()); let o = p; for (const x of parts) o = o[x]; o.splice(idx, 1); draw(); });
      const everything = el.querySelector("[data-approve-everything]");
      // Approving in bulk never approves a line the second check doubted: those wait to be read one by one.
      const approveMany = (list) => {
        let held = 0;
        for (const x of list) { if (x.warning && !x.approved) { held++; continue; } x.approved = true; }
        draw();
        if (held) msg(el.querySelector("[data-held]"), "info", `${held} line${held === 1 ? " has" : "s have"} a "Check this" note, so ${held === 1 ? "it was" : "they were"} left unticked. Read ${held === 1 ? "it" : "each one"}, fix or delete what isn't true, then tick ${held === 1 ? "it" : "them"} yourself.`);
      };
      if (everything) everything.onclick = () => {
        if (!confirm("Approve every piece? Only do this if you've read them and every line is true.")) return;
        approveMany([...["summaries", "headers", "skills", "education", "bases"].flatMap((k) => arr(p[k])), ...["experience", "projects"].flatMap((k) => arr(p[k]).flatMap((e) => arr(e.bullets)))]);
      };
      el.querySelectorAll("[data-all]").forEach((e) => e.onclick = () => { let o = p; for (const x of e.dataset.all.split(".")) o = o[x]; approveMany(arr(o)); });
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
        if (r.problems && r.problems.length) {
          // Often the missing piece is one "approve all" held back because the second check doubted it.
          const held = [...arr(p.summaries), ...["experience", "projects"].flatMap((k) => arr(p[k]).flatMap((e) => arr(e.bullets)))].filter((x) => x.warning && !x.approved);
          const sumHeld = arr(p.summaries).some((x) => x.warning && !x.approved) && !arr(p.summaries).some((x) => x.approved);
          if (sumHeld) return 'Your summary has a "Check this" note, so it is still unticked. Read it, fix anything that isn\'t true, then tick it.';
          return "With only the approved pieces: " + r.problems.slice(0, 3).join(" ") + (held.length ? ` (${held.length} line${held.length === 1 ? " with a \"Check this\" note is" : "s with a \"Check this\" note are"} still unticked.)` : "");
        }
        return null;
      },
    };
  }

  // ---------- 3. About you: the answers forms ask for ----------
  const DEM = {
    gender: ["Gender", ["decline", "Male", "Female", "Non-binary"]],
    hispanic: ["Hispanic or Latino", ["decline", "Yes", "No"]],
    race: ["Race", ["decline", "American Indian or Alaska Native", "Asian", "Black or African American", "Native Hawaiian or Other Pacific Islander", "White", "Two or More Races"]],
    veteran: ["Protected veteran", ["decline", "I am not a protected veteran", "I identify as one or more of the classifications of protected veteran"]],
    disability: ["Disability", ["decline", "No, I do not have a disability", "Yes, I have a disability (or previously had a disability)"]],
    lgbtq: ["Sexual orientation / LGBTQ+", ["decline", "Heterosexual", "Gay or Lesbian", "Bisexual", "Queer"]],
  };
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const SHIFTS = ["Mornings", "Afternoons", "Evenings", "Overnight"];
  const checks = (name, all, on) => `<div class="radio-row">${all.map((v) => `<label><input type="checkbox" name="${name}" value="${esc(v)}" ${(on || []).includes(v) ? "checked" : ""}>${esc(v)}</label>`).join("")}</div>`;
  const more = (title, hint, body, open) => `<details class="more" ${open ? "open" : ""}><summary><b>${title}</b><span>${hint}</span></summary><div class="form">${body}</div></details>`;

  function questions(el, cfg) {
    const a = cfg.answers;
    const kind = (cfg.prefs && cfg.prefs.jobKind) || "both";
    const hourly = kind !== "office", office = kind !== "hourly";
    const eduRow = (e = {}) => `<div class="sub-item" data-edu><div class="form-row">
      ${fld("School", inp("school", e.school, 'placeholder="School, college or program"'))}${fld("What you earned", inp("degree", e.degree, 'placeholder="High school diploma, GED, Associate, Bachelor of Science..."'))}${fld("Subject (optional)", inp("field", e.field))}</div>
      <div class="form-row">${fld("Started", inp("start", e.start, 'type="month"'))}${fld("Finished (or expect to)", inp("end", e.end, 'type="month"'))}
      <div style="align-self:end"><button type="button" class="btn ghost sm" data-rm-row>${icon("trash")}Remove</button></div></div></div>`;
    const yearsRow = (y = {}) => `<div class="form-row" data-years style="grid-template-columns:1fr 120px auto">
      <input class="inp" name="ytype" value="${esc(y.type || "")}" placeholder="${office ? "e.g. Software engineering, Customer service, Python" : "e.g. Customer service, Retail, Food service, Driving"}">
      <input class="inp" name="yyears" type="number" min="0" step="0.5" value="${esc(y.years ?? "")}" placeholder="Years">
      <button type="button" class="btn ghost sm" data-rm-row>${icon("trash")}</button></div>`;
    el.innerHTML = `<div class="form">
      <div class="callout blue" style="margin:0"><div>Only the first part is required. Everything below it is optional: the more you answer, the fewer forms stop to ask you.</div></div>
      <div class="section-t">Required</div>
      <div class="form-row">${fld("First name", inp("firstName", a.firstName, 'autocomplete="given-name"'))}${fld("Last name", inp("lastName", a.lastName, 'autocomplete="family-name"'))}</div>
      <div class="form-row">${fld("Email", inp("email", a.email, 'type="email" autocomplete="email"'), "Employers write to this address.")}${fld("Phone", inp("phone", a.phone, 'type="tel" autocomplete="tel"'))}</div>
      <div class="form-row">${fld("City", inp("city", a.city))}${fld("State", inp("state", a.state))}${fld("ZIP code", inp("zip", a.zip))}${fld("Country", inp("country", a.country))}</div>
      <div class="form-row">${fld(`Are you allowed to work in ${esc(/^united (states|kingdom)|netherlands|philippines/i.test(a.authCountry || "United States") ? "the " + (a.authCountry || "United States") : a.authCountry)}?`, radios("workAuthorized", a.workAuthorized, [["yes", "Yes"], ["no", "No"]]))}
        ${fld("Will you need a visa sponsor, now or later?", radios("needsSponsorship", a.needsSponsorship, [["no", "No"], ["yes", "Yes"]]))}
        ${fld("Are you 18 or older?", radios("over18", a.over18, [["yes", "Yes"], ["no", "No"]]))}</div>
      ${more("When you can work", "Days, shifts, hours, getting there", `
        ${fld("Days you can work", checks("days", DAYS, a.daysAvailable))}
        ${fld("Shifts you can work", checks("shifts", SHIFTS, a.shifts))}
        <div class="form-row">${fld("Hours you want", radios("hoursWanted", a.hoursWanted, [["either", "Full or part time"], ["full", "Full time"], ["part", "Part time"]]))}
          ${fld("When you can start", inp("startAvailability", a.startAvailability, 'placeholder="Right away, Two weeks after an offer..."'))}</div>
        <div class="form-row">${fld("Reliable transportation?", radios("transportation", a.transportation, [["yes", "Yes"], ["no", "No"], ["", "Don't say"]]))}
          ${fld("Valid driver's license?", radios("driversLicense", a.driversLicense, [["yes", "Yes"], ["no", "No"], ["", "Don't say"]]))}
          ${fld("Most you can lift (pounds)", inp("canLift", a.canLift, 'type="number" min="0" placeholder="e.g. 50"'), "Leave empty to be asked.")}</div>
        <div class="form-row">${fld("Your own insured car?", radios("ownVehicle", a.ownVehicle, [["yes", "Yes"], ["no", "No"], ["", "Don't say"]]), "Delivery jobs often need one.")}
          ${fld("Clean driving record?", radios("drivingRecord", a.drivingRecord, [["clean", "Yes"], ["no", "No"], ["", "Don't say"]]))}
          ${fld("Are you 21 or older?", radios("over21", a.over21, [["yes", "Yes"], ["no", "No"], ["", "Don't say"]]), "Some driving jobs require it.")}</div>
        <div class="form-row">${fld("Notice to give your current job", inp("noticePeriod", a.noticePeriod, 'placeholder="2 weeks, None..."'))}
          ${fld("Desired pay (optional)", inp("salary", a.salary, 'placeholder="e.g. $18 an hour"'), "Empty: the posted range, or \"open to discussing\".")}</div>
        <div class="form-row">${fld("Willing to move for a job?", radios("relocation", a.relocation, [["no", "No"], ["radius", "Only nearby"], ["anywhere", "Yes, anywhere"]]))}
          ${fld("Willing to travel for work?", radios("travel", a.travel, [["some", "Sometimes"], ["yes", "Yes"], ["no", "No"]]))}</div>`, hourly)}
      ${more("Work and school", "Experience, schooling, current job", `
        <div class="form-row">${fld("Current or most recent employer", inp("currentEmployer", a.currentEmployer))}${fld("Current or most recent job title", inp("currentTitle", a.currentTitle))}</div>
        ${fld("Schools", `<div class="sub-list" data-edu-list>${(a.education || []).map(eduRow).join("")}</div><div><button type="button" class="btn sm" data-add-edu>${icon("plus")}Add a school</button></div>`)}
        ${fld("Years of experience", `<div class="sub-list" data-years-list>${(a.years || []).map(yearsRow).join("")}</div><div><button type="button" class="btn sm" data-add-years>${icon("plus")}Add a kind of work</button></div>`,
          "Forms often ask \"how many years of X\". The app uses exactly these numbers, never more; anything not listed waits for you.")}
        ${fld("All work experience, any kind (years)", inp("totalYears", a.totalYears, 'type="number" min="0" step="0.5"'))}`, office)}
      ${more("Links and address", "LinkedIn, website, street address", `
        <div class="form-row">${fld("LinkedIn", inp("linkedin", a.linkedin, 'placeholder="https://www.linkedin.com/in/..."'))}${fld("Website or portfolio", inp("website", a.website))}${fld("GitHub", inp("github", a.github))}</div>
        ${fld("Other links", inp("otherLinks", a.otherLinks), "Separate with spaces.")}
        ${fld("Street address", inp("street", a.street), "Only used when a form requires it.")}
        <div class="form-row">${fld("Preferred first name", inp("preferredName", a.preferredName))}${fld("Country you're applying to work in", inp("authCountry", a.authCountry))}
          ${fld("How you heard about the job", inp("heardAbout", a.heardAbout), "\"Job board\" unless you change it.")}</div>`)}
      ${more("Legal questions", "Arbitration, background checks, criminal history", `
        ${fld("Criminal-history questions (\"Have you ever been convicted...\")", radios("convictions", a.convictions, [["ask", "Always ask me"], ["none", "Answer No: I have no convictions"]]))}
        ${fld("Background checks and drug tests, if you get an offer", radios("screenings", a.screenings, [["ask", "Always ask me"], ["yes", "Yes, I consent"]]), "Only plain yes/no questions. Anything that also waives your rights waits for you.")}
        ${fld("Arbitration agreements", radios("arbitration", a.arbitration, [["never", "Always ask me (recommended)"], ["plain", "Accept plain ones"], ["list", "Accept only for these companies"]]),
          "Jury and class-action waivers, non-competes and releases of claims always wait for you.")}
        <div data-arb-list style="${a.arbitration === "list" ? "" : "display:none"}"></div>`)}
      ${more("Voluntary self-identification", "Gender, race, veteran, disability: \"Decline\" unless you choose", `
        <div class="form-row">${Object.entries(DEM).map(([k, [label, opts]]) => fld(label, sel("dem_" + k, (a.demographics || {})[k] || "decline", opts.map((o) => [o, o === "decline" ? "Decline to answer" : o])))).join("")}</div>`)}
      ${more("Things you can never claim", "Skills or licenses you don't have", `<div data-cannot></div>
        <small class="hint">Any AI-written answer that mentions one is thrown out, and jobs that require one are skipped.</small>`)}
    </div>`;
    const cannot = tagInput(el.querySelector("[data-cannot]"), a.cannotClaim, office ? "e.g. Java, Kubernetes, security clearance" : "e.g. forklift license, CDL, bilingual Spanish");
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
          "authCountry", "workAuthorized", "needsSponsorship", "travel", "over18", "currentEmployer", "currentTitle", "noticePeriod", "startAvailability", "relocation", "heardAbout",
          "salary", "arbitration", "screenings", "convictions", "hoursWanted", "transportation", "driversLicense", "canLift", "ownVehicle", "drivingRecord", "over21"]) out[k] = val(el, k);
        out.daysAvailable = [...el.querySelectorAll("[name=days]:checked")].map((x) => x.value);
        out.shifts = [...el.querySelectorAll("[name=shifts]:checked")].map((x) => x.value);
        out.totalYears = Number(val(el, "totalYears")) || 0;
        out.education = [...el.querySelectorAll("[data-edu]")].map((r) => ({ school: val(r, "school"), degree: val(r, "degree"), field: val(r, "field"), start: val(r, "start"), end: val(r, "end") })).filter((e) => e.school);
        out.years = [...el.querySelectorAll("[data-years]")].map((r) => ({ type: val(r, "ytype"), years: Number(val(r, "yyears")) || 0 })).filter((y) => y.type);
        out.demographics = Object.fromEntries(Object.keys(DEM).map((k) => [k, val(el, "dem_" + k)]));
        out.cannotClaim = cannot.get();
        out.arbitrationCompanies = arbList.get();
        const missing = [];
        if (!out.firstName || !out.lastName) missing.push("your first and last name");
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) missing.push("a valid email address");
        if (!out.phone) missing.push("your phone number");
        if (!out.city) missing.push("your city");
        if (!out.workAuthorized) missing.push("whether you're allowed to work there");
        if (!out.needsSponsorship) missing.push("whether you'll need a visa sponsor");
        if (!out.over18) missing.push("whether you're 18 or older");
        if (missing.length) return "Please add " + missing.join(", ") + ".";
        for (const e of out.education) if (e.end && e.start && e.end < e.start) return `${e.school}: the finish date is before the start date.`;
        cfg.answers = await api("/api/answers/save", { answers: out });
        return null;
      },
    };
  }

  // ---------- 4. What jobs, where, and where to look ----------
  const SUGGEST = {
    office: ["Software Engineer", "Data Analyst", "Customer Success Manager", "Administrative Assistant", "Accountant", "Marketing Coordinator", "Project Coordinator", "IT Support Specialist"],
    hourly: ["Cashier", "Retail Sales Associate", "Customer Service Representative", "Warehouse Associate", "Barista", "Server", "Line Cook", "Delivery Driver", "Front Desk Agent", "Caregiver", "Medical Assistant", "Janitor"],
  };
  const LEVELS = [["junior", "No experience needed or entry level"], ["middle", "Some experience (mid level)"], ["senior", "Senior"], ["lead", "Manager or team lead"], ["intern", "Internships"]];
  const BOARDS = [
    ["hiringcafe", "HiringCafe", "Jobs of every kind, straight from employers' own sites. Best for most people."],
    ["freehire", "freehire", "Office, tech and professional jobs."],
    ["simplify", "Simplify lists", "New-graduate jobs and internships, mostly tech (Simplify's free lists on GitHub)."],
    ["google", "Google Jobs", "What Google's job search shows. Needs a free SerpApi key (250 searches a month)."],
  ];
  function prefs(el, cfg) {
    const p = cfg.prefs;
    const kind = p.jobKind || "both";
    let cities = [...(p.cities || [])];
    const boards = { ...(p.boards || {}) };
    const sugg = kind === "office" ? SUGGEST.office : kind === "hourly" ? SUGGEST.hourly : [...SUGGEST.hourly.slice(0, 6), ...SUGGEST.office.slice(0, 4)];
    el.innerHTML = `<div class="form">
      ${fld("What jobs do you want?", `<div data-titles></div><div class="chips" data-sugg style="margin-top:8px">${sugg.map((t) => `<button type="button" class="tag chip-add">+ ${esc(t)}</button>`).join("")}</div>`,
        "Type a job title and press Enter, or click a suggestion. Add a few similar titles to find more jobs.")}
      <div class="ai-sugg" data-aisugg>
        <div class="row-actions"><button type="button" class="btn sm" data-aigo>${icon("bolt")}Not sure? Suggest jobs from my resume</button>
          <small class="hint">Jobs your experience, licenses and certificates qualify you for, the ones that tend to pay more first.</small></div>
        <div data-ailist></div></div>
      <div class="form-row">${fld("Lowest pay you'd take (optional)", `<div class="row-actions" style="flex-wrap:nowrap"><input class="inp" name="minPay" type="number" min="0" step="0.5" value="${esc(p.minPay || "")}" placeholder="e.g. 25" style="max-width:9rem">
          ${sel("minPayPer", p.minPayPer || "hour", [["hour", "an hour"], ["year", "a year"]])}</div>`, "Jobs that post a lower top rate are skipped. Jobs that don't post pay are kept.")}</div>
      <div class="fld"><span>Where?</span><div class="suggest"><input class="inp" data-city placeholder="Type your city, then pick it from the list"><div class="suggest-list" hidden></div></div>
        <div data-cities class="tags" style="margin-top:6px"></div></div>
      <div class="fld"><span>How far are you willing to go? <b data-radius-val>${esc(p.radius)} ${p.radiusUnit === "km" ? "km" : "miles"}</b></span>
        <input type="range" name="radius" min="1" max="100" value="${esc(Math.min(100, p.radius || 25))}" style="width:100%;max-width:420px"></div>
      <label class="check"><input type="checkbox" name="remote" ${p.remote ? "checked" : ""}>Also jobs I can do from home (remote)</label>
      ${fld("What level?", `<div class="radio-row">${LEVELS.map(([v, l]) => `<label><input type="checkbox" name="lvl" value="${v}" ${(v === "intern" ? p.internships : (p.seniority || []).includes(v)) ? "checked" : ""}>${l}</label>`).join("")}</div>`)}
      <div class="section-t">Where to look</div>
      <div class="board-list">${BOARDS.map(([id, name, desc]) => `<label class="board ${boards[id] ? "on" : ""}"><input type="checkbox" name="board" value="${id}" ${boards[id] ? "checked" : ""}>
        <div><b>${name}</b><small>${desc}</small>${id === "google" ? `<div data-google></div>` : ""}</div></label>`).join("")}</div>
      <small class="hint">Found a job somewhere else (Google, Simplify, Indeed, a company's website)? Use <b>Add a job</b> on the Overview and paste its link.</small>
      ${more("More options", "Exclusions, posting age, experience limits", `
        ${fld("What you want the work to involve (optional)", `<div data-keywords></div>`, "The AI favors jobs like these, e.g. healthcare, React, working outdoors.")}
        ${fld("Words that rule a job title out (optional)", `<div data-titleex></div>`)}
        ${fld("Companies to never apply to", `<div data-exclude></div>`, "Your current employer, and anywhere you would not go.")}
        <label class="check"><input type="checkbox" name="excludeAgencies" ${p.excludeAgencies ? "checked" : ""}>Skip recruiting agencies and repost sites</label>
        <div class="form-row">${fld("Most years of experience a job may require", inp("maxYearsRequired", p.maxYearsRequired, 'type="number" min="0" max="30"'))}
          ${fld("Only jobs posted in the last", sel("postedWithinDays", p.postedWithinDays, [[3, "3 days"], [7, "7 days"], [14, "14 days"], [30, "30 days"], [60, "60 days"]]))}
          ${fld("Distance in", sel("radiusUnit", p.radiusUnit, [["mi", "miles"], ["km", "kilometers"]]))}
          ${fld("Remote jobs open to people in", `<select name="remoteCountry" data-countries></select>`)}</div>
        ${fld("Jobs you already applied to elsewhere", `<textarea name="alreadyApplied" rows="3" placeholder="One per line: a job link, or Company - Job title">${esc(p.alreadyApplied || "")}</textarea>`, "The app never applies to these.")}`)}
    </div>`;
    const titles = tagInput(el.querySelector("[data-titles]"), p.titles, kind === "office" ? "e.g. Software Engineer" : "e.g. Cashier");
    el.querySelectorAll(".chip-add").forEach((b) => b.onclick = () => {
      const input = el.querySelector("[data-titles] input");
      input.value = b.textContent.replace(/^\+\s*/, "");
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      b.remove();
    });
    // Suggestions from the resume: each one names what of theirs qualifies them, and adds with one click.
    el.querySelector("[data-aigo]").onclick = async (e) => {
      const btn = e.currentTarget, host = el.querySelector("[data-ailist]");
      btn.disabled = true;
      msg(host, "info", "Reading your resume and thinking about jobs you qualify for...");
      const r = await api("/api/prefs/suggest", {});
      btn.disabled = false;
      if (r.error) return msg(host, "err", r.error);
      if (!r.titles.length) return msg(host, "info", "No new ideas beyond the titles you already have.");
      host.innerHTML = `<div class="sugg-list">${r.titles.map((x, i) => `<div class="sugg-item"><div><b>${esc(x.title)}</b>${x.payText ? ` <span class="pill ${x.pay === "more" ? "ok" : ""}">${esc(x.payText)}</span>` : ""}
          <div class="muted">${esc(x.why)}</div></div><button type="button" class="btn sm" data-add-sugg="${i}">${icon("plus")}Add</button></div>`).join("")}</div>
        <small class="hint">Ideas from the AI, based only on your approved resume. To be shown only jobs that pay more than you make now, put your current pay in <b>Lowest pay you'd take</b> below.</small>`;
      host.querySelectorAll("[data-add-sugg]").forEach((b) => b.onclick = () => {
        const input = el.querySelector("[data-titles] input");
        input.value = r.titles[Number(b.dataset.addSugg)].title;
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        b.disabled = true; b.innerHTML = `${icon("check")}Added`;
      });
    };
    // Someone with a resume but no titles yet sees ideas from their own resume first, not a generic list.
    if (!titles.get().length && cfg.profile && (cfg.profile.experience || []).some((e) => (e.bullets || []).some((b) => b.approved))) el.querySelector("[data-aigo]").click();
    const keywords = tagInput(el.querySelector("[data-keywords]"), p.keywords, "e.g. healthcare");
    const titleEx = tagInput(el.querySelector("[data-titleex]"), p.titleExclude, "e.g. night shift, sales");
    const exclude = tagInput(el.querySelector("[data-exclude]"), p.excludeCompanies, "Company name");
    const unit = () => (val(el, "radiusUnit") === "km" ? "km" : "miles");
    const r = el.querySelector("[name=radius]");
    r.oninput = () => { el.querySelector("[data-radius-val]").textContent = `${r.value} ${unit()}`; };
    el.querySelector("[name=radiusUnit]").onchange = r.oninput;
    el.querySelectorAll("[name=board]").forEach((b) => b.onchange = () => { b.closest(".board").classList.toggle("on", b.checked); boards[b.value] = b.checked; if (b.value === "google") drawGoogle(); });
    const drawGoogle = () => {
      const host = el.querySelector("[data-google]");
      if (!boards.google) { host.innerHTML = ""; return; }
      host.innerHTML = cfg.hasSerpKey ? `<small class="ok-line">Key saved. ${esc(cfg.googleUse || 0)} searches used this month. <a href="#" data-gremove>Remove key</a></small>`
        : `<div class="row-actions" style="margin-top:6px"><input class="inp" data-gkey type="password" placeholder="Paste your SerpApi key" style="max-width:280px">
           <button type="button" class="btn sm" data-gsave>Save key</button><button type="button" class="btn ghost sm" data-glink>Get a free key</button></div><div data-gmsg></div>`;
      const s = host.querySelector("[data-gsave]");
      if (s) s.onclick = async (e) => { e.preventDefault(); const k = host.querySelector("[data-gkey]").value; const res = await api("/api/google/save", { key: k });
        if (res.error) return msg(host.querySelector("[data-gmsg]"), "err", res.error); cfg.hasSerpKey = true; drawGoogle(); };
      const l = host.querySelector("[data-glink]"); if (l) l.onclick = (e) => { e.preventDefault(); openUrl("https://serpapi.com/users/sign_up"); };
      const rm = host.querySelector("[data-gremove]"); if (rm) rm.onclick = async (e) => { e.preventDefault(); await api("/api/google/remove", {}); cfg.hasSerpKey = false; drawGoogle(); };
    };
    drawGoogle();
    const drawCities = () => {
      const host = el.querySelector("[data-cities]");
      host.innerHTML = cities.length ? cities.map((c, i) => `<span class="tag">${icon("pin")}${esc(c.label || c.name)}<button type="button" data-i="${i}">&times;</button></span>`).join("") : `<span class="muted" style="padding:0 6px">No city yet</span>`;
      host.querySelectorAll("button").forEach((b) => b.onclick = () => { cities.splice(Number(b.dataset.i), 1); drawCities(); });
    };
    drawCities();
    const box = el.querySelector("[data-city]"), list = el.querySelector(".suggest-list");
    let t;
    box.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
      const res = await api("/api/cities?q=" + encodeURIComponent(box.value));
      list.hidden = !res.length;
      list.innerHTML = res.map((c, i) => `<div data-i="${i}">${esc(c.label)}</div>`).join("");
      list.querySelectorAll("div").forEach((d) => d.onclick = () => { const c = res[Number(d.dataset.i)]; if (!cities.some((x) => x.label === c.label)) cities.push(c); box.value = ""; list.hidden = true; drawCities(); });
    }, 150); };
    box.onblur = () => setTimeout(() => { list.hidden = true; }, 200);
    api("/api/countries").then((cs) => { el.querySelector("[data-countries]").innerHTML = cs.map((c) => `<option value="${c.code}" ${c.code === p.remoteCountry ? "selected" : ""}>${esc(c.name)}</option>`).join(""); });
    return {
      async save() {
        const lv = [...el.querySelectorAll("[name=lvl]:checked")].map((x) => x.value);
        const out = {
          titles: titles.get(), keywords: keywords.get(), titleExclude: titleEx.get(), excludeCompanies: exclude.get(),
          cities, radius: Number(val(el, "radius")) || 25, radiusUnit: val(el, "radiusUnit"), remote: val(el, "remote"), remoteCountry: val(el, "remoteCountry") || p.remoteCountry || "US",
          seniority: lv.filter((x) => x !== "intern").flatMap((x) => (x === "lead" ? ["lead", "staff", "principal"] : [x])), internships: lv.includes("intern"),
          maxYearsRequired: Number(val(el, "maxYearsRequired")) || 0, postedWithinDays: Number(val(el, "postedWithinDays")) || 14,
          excludeAgencies: val(el, "excludeAgencies"), alreadyApplied: val(el, "alreadyApplied"), boards,
          minPay: Number(val(el, "minPay")) || 0, minPayPer: val(el, "minPayPer") || "hour",
        };
        if (!out.titles.length) return "Add at least one job title (type it and press Enter, or click a suggestion).";
        if (out.minPayPer === "hour" && out.minPay > 300) return `Lowest pay: $${out.minPay.toLocaleString()} an hour looks like a yearly salary. Choose "a year" next to it, or fix the number.`;
        if (out.minPayPer === "year" && out.minPay > 0 && out.minPay < 1000) return `Lowest pay: $${out.minPay} a year looks like an hourly rate. Choose "an hour" next to it, or fix the number.`;
        if (!out.cities.length && !out.remote) return "Pick your city from the list, or tick remote jobs.";
        if (!lv.length) return "Pick at least one level.";
        if (!Object.values(boards).some(Boolean)) return "Pick at least one place to look for jobs.";
        if (boards.google && !cfg.hasSerpKey) return "Google Jobs needs a SerpApi key: paste it, or untick Google Jobs.";
        cfg.prefs = await api("/api/prefs/save", { prefs: out });
        return null;
      },
    };
  }

  // ---------- Job site accounts (Workday): the app signs up and signs in, only when the user turns it on ----------
  function accounts(el) {
    let st = null;
    const draw = () => {
      el.innerHTML = `<div class="form">
        <p class="hint" style="margin:0">Many big employers take applications only through Workday, where every company is its own site and you need an account on each one. With this on, the app makes the account with the email and password below, confirms it from your mailbox, signs in and fills the whole application. Without it, those jobs go to <b>Apply yourself</b>.</p>
        <label class="check"><input type="checkbox" name="acc_on" ${st.enabled ? "checked" : ""}><span><b>Make accounts and sign in on Workday job sites for me</b></span></label>
        <div class="form-row">${fld("Email for the accounts", inp("acc_email", st.email, 'type="email" autocomplete="email"'), "Employers write to this address.")}
          ${fld("Password for the accounts", inp("acc_pass", "", `type="password" autocomplete="new-password" placeholder="${st.hasPassword ? "Saved. Type a new one to change it" : "Type a password"}"`),
            "The same password on every site, as you chose. Use one you don't use anywhere else: if one site leaks it, the others are at risk. It needs 8+ characters with upper and lower case, a number and a symbol.")}</div>
        <label class="check"><input type="checkbox" name="acc_consent" ${st.consent ? "checked" : ""}><span>The app may accept each site's ordinary terms of use and privacy policy when it makes an account for me. Arbitration agreements and other legal waivers still always wait for me. Some job sites' terms may not allow sign-ups by software; I am responsible for the accounts made in my name.</span></label>
        ${st.mailbox ? "" : `<div class="msg info">Connect your mailbox (the Mailbox section) too: Workday emails a link to confirm each new account, and the app clicks it for you.</div>`}
        ${st.sites.length ? `<div class="section-t">Accounts the app has made (${st.sites.length})</div><div class="sub-list">${st.sites.map((x) => `<div class="sub-item" style="grid-template-columns:minmax(0,1fr) auto;display:grid;align-items:center">
            <div><b>${esc(x.host)}</b><div class="muted">${esc(x.email || "")}, ${esc({ created: "made and confirmed", unverified: "waiting for the confirmation email", existed: "you already had one", failed: "could not be made: " + (x.error || "") }[x.status] || x.status)}</div></div>
            <span class="muted">${esc(String(x.createdAt || "").slice(0, 10))}</span></div>`).join("")}</div>` : ""}
      </div>`;
    };
    el.innerHTML = `<div class="muted">Loading...</div>`;
    api("/api/accounts").then((r) => { st = r; draw(); });
    return {
      async save() {
        if (!st) return null;
        const r = await api("/api/accounts/save", { enabled: val(el, "acc_on"), consent: val(el, "acc_consent"), email: val(el, "acc_email"), password: el.querySelector("[name=acc_pass]").value });
        if (r.error) return r.error;
        st = await api("/api/accounts"); draw();
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
        "Minimized keeps it out of your way (on a Mac, just past the edge of the screen, behind your windows); \"Show the browser\" on the Overview brings it up. With no window at all, some sites are more likely to ask for a security code.")}
      <div class="row-actions"><button type="button" class="btn sm" data-detect>${icon("search")}Check browsers</button><button type="button" class="btn sm" data-install>${icon("upload")}Download Chromium now</button></div>
      <div data-msg></div></div>`;
    const m = el.querySelector("[data-msg]");
    el.querySelector("[data-detect]").onclick = async () => { msg(m, "info", "Checking..."); const r = await api("/api/browser/detect", {}); msg(m, "ok", `Chrome: ${r.chrome ? "found" : "not found"}, Edge: ${r.msedge ? "found" : "not found"}, Chromium: ${r.chromium ? "downloaded" : "not downloaded"}`); };
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

  // ---------- Application history: survives reinstalls, moves to a new computer ----------
  function history(el, cfg, onChange) {
    const draw = async () => {
      const h = await api("/api/history");
      el.innerHTML = `<div class="form">
        <p class="hint" style="margin:0">Every job you applied to is kept in a small file outside the app (${h.local} so far). After a reinstall, or on a new
          computer, import it and the app will never apply to those jobs again. It holds only employer, job title, location, the
          posting's address and the date: no answers, resumes or screenshots.</p>
        <label class="check"><input type="checkbox" data-on ${h.enabled ? "checked" : ""}>Keep an up-to-date copy in <span class="mono">${esc(h.file ? h.file.replace(/[\\/][^\\/]+$/, "") : "")}</span></label>
        <div class="row-actions">
          <button type="button" class="btn sm" data-folder>${icon("file")}Change folder</button>
          ${h.file && h.backup ? `<button type="button" class="btn sm" data-show>${icon("ext")}Show the file</button>` : ""}
          <button type="button" class="btn sm" data-save>${icon("upload")}Save a copy...</button>
          <button type="button" class="btn sm primary" data-import>${icon("plus")}Import a history file</button>
          <input type="file" accept=".gz,.json" hidden>
        </div>
        <small class="hint">To move to a new computer: copy the file over (or keep the folder in iCloud Drive, OneDrive or Dropbox), then use Import there.</small>
        <div data-msg></div></div>`;
      const m = el.querySelector("[data-msg]"), input = el.querySelector("input[type=file]");
      el.querySelector("[data-on]").onchange = async (e) => { await api("/api/settings", { historyBackup: e.target.checked }); draw(); };
      el.querySelector("[data-folder]").onclick = async () => { const d = await window.ja.pickFolder(); if (d) { await api("/api/settings", { historyFolder: d }); draw(); } };
      const show = el.querySelector("[data-show]"); if (show) show.onclick = () => window.ja.showFile(h.file);
      el.querySelector("[data-save]").onclick = async () => { const f = await window.ja.saveHistory(); if (f) msg(m, "ok", "Saved to " + f); };
      el.querySelector("[data-import]").onclick = () => input.click();
      input.onchange = async () => {
        const f = input.files[0]; if (!f) return;
        const buf = new Uint8Array(await f.arrayBuffer()); let s = "";
        for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
        const r = await api("/api/history/import", { b64: btoa(s) });
        input.value = "";
        if (r.error) return msg(m, "err", r.error);
        await draw();
        msg(el.querySelector("[data-msg]"), "ok", importedText(r));
        onChange && onChange(r);
      };
    };
    draw();
    return { save: async () => null };
  }
  const importedText = (r) => `Imported ${r.total} application${r.total === 1 ? "" : "s"}: ${r.added} added, ${r.updated} marked as applied, ${r.already} already here. None of them will be applied to again.`;

  window.Forms = { ai, resumes, creator, github, accounts, studio, review, fillPage, questions, prefs, mailbox, running, history, importedText, esc, icon, msg };
})();
