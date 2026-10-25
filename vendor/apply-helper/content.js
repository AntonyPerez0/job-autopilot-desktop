"use strict";
// Runs in every frame. Reads the form (scrape), fills it from the kit
// (fill), and in the top frame shows the panel. It never clicks a submit,
// next or apply button: the only clicks are on radio/checkbox inputs and on
// dropdown options.
(() => {
  if (window.__applyHelper) return;
  window.__applyHelper = true;

  const IS_TOP = window === window.top;
  const HID = "data-apply-helper-id";
  let hidSeq = 0;

  // ---------- text helpers ----------

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const STOP = new Set(("a an and are as at be by can do does for from have how i if in is it me of on or " +
    "our please select that the this to us we what when which will with you your yes no optional required").split(" "));
  const ALIAS = { us: "united states", usa: "united states", "u.s.": "united states", ca: "california" };

  function norm(s) {
    return clean(s).toLowerCase().replace(/\(optional\)|\(required\)|\*/g, " ")
      .replace(/[^a-z0-9+#@./ ]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function tokens(s) {
    return new Set(norm(s).split(" ").filter((w) => w && !STOP.has(w)).map((w) => w.replace(/s$/, "")));
  }
  function dice(a, b) {
    const A = tokens(a), B = tokens(b);
    if (!A.size || !B.size) return 0;
    let n = 0;
    for (const w of A) if (B.has(w)) n++;
    return (2 * n) / (A.size + B.size);
  }

  // Canonical identity fields, so "Given name" finds "First name".
  const CANON = [
    ["first", /\b(first|given|preferred first) name\b|^first$/],
    ["last", /\b(last|family|sur) ?name\b|^last$/],
    ["full", /^(full |legal |your )?name$|\bfull (legal )?name\b/],
    ["email", /\be-?mail\b/],
    ["phone", /\b(phone|mobile|cell|telephone)\b/],
    ["linkedin", /\blinkedin\b/],
    ["github", /\bgithub\b/],
    ["website", /\b(website|portfolio|personal (site|url))\b/],
    ["resume", /\b(resume|cv|résumé)\b/],
    ["cover", /\bcover letter\b/],
  ];
  function canon(label) {
    const n = norm(label);
    if (n.length > 60) return null; // long questions are not identity fields
    for (const [k, re] of CANON) if (re.test(n)) return k;
    return null;
  }

  function score(kitLabel, fieldLabel) {
    const a = norm(kitLabel), b = norm(fieldLabel);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const ca = canon(kitLabel), cb = canon(fieldLabel);
    if (ca && cb) return ca === cb ? 0.95 : 0;
    let s = dice(kitLabel, fieldLabel);
    const A = tokens(kitLabel), B = tokens(fieldLabel);
    if (A.size >= 2 && [...A].every((w) => B.has(w))) s = Math.max(s, 0.8);
    if (b.startsWith(a) || a.startsWith(b)) s = Math.max(s, 0.75);
    return s;
  }

  // ---------- reading the form ----------

  // Text as displayed: follows <slot>s to the text they show, and into shadow roots.
  // (innerText alone gives "*" for <label><slot name="label"></slot>*</label>.)
  function composedText(n, depth = 0) {
    if (!n || depth > 40) return "";
    if (n.nodeType === 3) return n.nodeValue;
    if (n.nodeType !== 1 && n.nodeType !== 11) return "";
    if (n.nodeType === 1) {
      if (/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(n.tagName)) return "";
      if (n.tagName === "SLOT") {
        const a = n.assignedNodes({ flatten: true });
        return (a.length ? a : [...n.childNodes]).map((c) => composedText(c, depth + 1)).join(" ");
      }
      const sr = shadowOf(n);
      if (sr) return composedText(sr, depth + 1);
    }
    return [...n.childNodes].map((c) => composedText(c, depth + 1)).join(" ");
  }
  const txt = (el) => {
    if (!el) return "";
    const t = clean(el.innerText || el.textContent);
    if (el.querySelector && (el.querySelector("slot") || shadowOf(el) || el.tagName === "SLOT")) {
      const c = clean(composedText(el));
      if (c.length > t.length) return c;
    }
    return t;
  };

  // ---------- shadow DOM (SmartRecruiters, Workday parts, many design systems) ----------
  // Firefox lets add-ons into closed shadow roots too (openOrClosedShadowRoot).
  const shadowOf = (el) => { try { return el.openOrClosedShadowRoot || el.shadowRoot || null; } catch (e) { return null; } };
  // Every element matching sel, in page order, inside shadow roots too (but never our own panel).
  function deepAll(sel, root = document) {
    const out = [];
    const walk = (r) => {
      for (const el of r.querySelectorAll("*")) {
        if (el.id === "apply-helper-host") continue;
        if (el.matches(sel)) out.push(el);
        const sr = shadowOf(el);
        if (sr) walk(sr);
      }
    };
    walk(root);
    return out;
  }
  // The parent, stepping out of a shadow root to its host.
  const up = (n) => n.parentElement || (n.parentNode && n.parentNode.host) || null;
  const rootOf = (n) => (n.getRootNode ? n.getRootNode() : document);

  function isPanel(el) {
    return el.closest && el.closest("#apply-helper-host");
  }

  function shown(el) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }

  function visibleControl(el) {
    if (el.type === "file") return true; // usually hidden behind a styled button
    if (shown(el)) return true;
    const lab = el.labels && el.labels[0];
    return !!(lab && shown(lab)) || !!(el.parentElement && shown(el.parentElement) && /radio|checkbox/.test(el.type));
  }

  function byIds(ids, from) {
    const r = from ? rootOf(from) : document;
    const get = (id) => (r.getElementById ? r.getElementById(id) : null) || document.getElementById(id);
    return clean((ids || "").split(/\s+/).filter(Boolean).map((id) => txt(get(id))).join(" "));
  }

  const GENERIC = /^(attach|upload|choose( a)? files?|browse|dropbox|google drive|enter manually|select( a)? files?|add( a)? files?|locate me)\*?$/i;

  // The text of the nearest question-like element before `el` inside its form block.
  function nearbyLabel(el, exclude) {
    let cur = el; // el, or the shadow host that holds it in anc's tree
    let anc = el.parentElement || (el.parentNode && el.parentNode.host);
    if (anc === el.parentNode.host) cur = anc;
    for (let depth = 0; anc && depth < 7 && anc !== document.body; depth++) {
      const cands = anc.querySelectorAll("label, legend, h1, h2, h3, h4, h5, p, span, div, [class*='label' i], [class*='question' i]");
      let best = "";
      for (const c of cands) {
        if (c.contains(cur) || (exclude && exclude.some((x) => c.contains(x) || x.contains(c)))) continue;
        if (!(c.compareDocumentPosition(cur) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        if (c.querySelector("input, select, textarea")) continue;
        const t = txt(c);
        if (t.length >= 2 && t.length <= 400 && !GENERIC.test(t)) best = t; // keep the last one before el
      }
      if (best) return best;
      if (anc.parentElement) anc = anc.parentElement;
      else if (anc.parentNode && anc.parentNode.host) { cur = anc.parentNode.host; anc = up(cur); }
      else anc = null;
    }
    return "";
  }

  function hostLabel(el) {
    const host = rootOf(el).host;
    if (!host) return "";
    return host.getAttribute("label") || host.getAttribute("aria-label") ||
      (host.labels && host.labels.length ? [...host.labels].map(txt).join(" ") : "") ||
      byIds(host.getAttribute("aria-labelledby"), host) || "";
  }

  function labelOf(el) {
    const ok = (t) => (t = clean(t)) && !GENERIC.test(t) ? t : "";
    const t = ok(byIds(el.getAttribute("aria-labelledby"), el)) ||
      ok(el.labels && [...el.labels].map(txt).join(" ")) ||
      ok(el.getAttribute("aria-label")) || ok(hostLabel(el)) || ok(nearbyLabel(el)) ||
      ok(el.placeholder || el.title) || clean((el.name || el.id || "").replace(/[_\-\[\]]+/g, " "));
    return t.slice(0, 400);
  }

  function optionLabel(input) {
    if (input.labels && input.labels.length) return txt(input.labels[0]);
    const lb = input.getAttribute("aria-labelledby");
    if (lb) return byIds(lb, input);
    if (input.getAttribute("aria-label")) return input.getAttribute("aria-label");
    const next = input.nextElementSibling || (input.parentElement && input.parentElement);
    return txt(next) || input.value;
  }

  function strictGroupLabel(first) {
    const fs = first.closest("fieldset");
    const lg = fs && fs.querySelector("legend");
    if (lg && txt(lg)) return txt(lg);
    const grp = first.closest("[role=radiogroup], [role=group]");
    return grp ? clean(byIds(grp.getAttribute("aria-labelledby"), grp) || grp.getAttribute("aria-label") || "") : "";
  }

  function groupLabel(inputs) {
    const first = inputs[0];
    const fs = first.closest("fieldset");
    if (fs) {
      const lg = fs.querySelector("legend");
      if (lg && txt(lg)) return txt(lg);
    }
    const grp = first.closest("[role=radiogroup], [role=group]");
    if (grp) {
      const t = byIds(grp.getAttribute("aria-labelledby"), grp) || grp.getAttribute("aria-label");
      if (t) return clean(t);
    }
    const optLabels = inputs.flatMap((i) => [...(i.labels || [])]);
    return nearbyLabel(first, optLabels.concat(inputs)) || first.name || "";
  }

  function required(el) {
    const host = rootOf(el).host;
    return !!(el.required || el.getAttribute("aria-required") === "true" || (host && (host.hasAttribute("required") || host.getAttribute("aria-required") === "true")) ||
      /\*\s*$/.test(labelOf(el)));
  }

  function tag(el) {
    if (!el.getAttribute(HID)) el.setAttribute(HID, String(++hidSeq));
    return el.getAttribute(HID);
  }

  // ---------- react-select (Greenhouse, Lever and many others) ----------
  // These dropdowns ignore script-made mouse and key events, so they are read
  // and set through the component itself. In Firefox, wrappedJSObject reaches
  // the page's objects from the content script.
  const page = (o) => (o && o.wrappedJSObject) || o;
  const toPage = (o) => (typeof cloneInto === "function" ? cloneInto(o, window) : o);

  function reactSelect(el) {
    try {
      const w = page(el);
      const k = Object.keys(w).find((x) => x.startsWith("__reactFiber"));
      let f = k && w[k];
      for (let i = 0; f && i < 40; i++, f = f.return) {
        const sn = f.stateNode;
        if (sn && typeof sn.selectOption === "function" && sn.props) return sn;
      }
    } catch (e) { /* not React */ }
    return null;
  }
  function rsOptions(rs) {
    const out = [];
    for (const o of Array.from(rs.props.options || [])) {
      if (o && o.options) for (const x of Array.from(o.options)) out.push(x);
      else if (o) out.push(o);
    }
    return out;
  }
  function rsLabel(rs, o) {
    try { return clean(String(rs.props.getOptionLabel ? rs.props.getOptionLabel(o) : o.label)); } catch (e) { return clean(String(o.label || "")); }
  }
  function rsHasValue(rs) {
    const v = rs.props.value;
    if (v == null || v === "") return false;
    return typeof v.length === "number" ? v.length > 0 : true; // multi-selects hold an array
  }
  // true: picked; false: no matching option; null: not a react-select
  async function rsPick(el, value) {
    const rs = reactSelect(el);
    if (!rs) return null;
    const query = (expandPlace(value) ? value.split(",")[0] : value).slice(0, 60);
    let opts = rsOptions(rs);
    let i = bestOption(value, opts.map((o) => rsLabel(rs, o)));
    if (i < 0 && typeof rs.props.loadOptions === "function") {
      // async lists (schools, degrees): ask the component's own loader
      for (const q of [query, query.split(/[ ,(]/)[0]]) {
        try {
          let r = await rs.props.loadOptions(q, toPage([]), toPage({ page: 1 }));
          r = page(r);
          const list = Array.from((r && (Array.isArray(r) ? r : r.options)) || []);
          const flat = list.flatMap((o) => (o && o.options ? Array.from(o.options) : [o]));
          const j = bestOption(value, flat.map((o) => rsLabel(rs, o)));
          if (j >= 0) { opts = flat; i = j; break; }
        } catch (e) { /* loader failed */ }
      }
    }
    if (i < 0 && typeof rs.props.onInputChange === "function") {
      // search-as-you-type lists (locations): type through the component, wait for results
      try { rs.props.onInputChange(query, toPage({ action: "input-change", prevInputValue: "" })); } catch (e) { /* ignore */ }
      for (let t = 0; t < 20 && i < 0; t++) {
        await sleep(250);
        opts = rsOptions(rs);
        i = bestOption(value, opts.map((o) => rsLabel(rs, o)));
      }
    }
    if (i < 0) return false;
    rs.selectOption(opts[i]);
    await sleep(150);
    return true;
  }

  const roots = new WeakMap();
  let rootSeq = 0;
  function rootKey(el) {
    const r = rootOf(el);
    if (!roots.has(r)) roots.set(r, ++rootSeq);
    return roots.get(r);
  }

  const isChecked = (o) => o.getAttribute("aria-checked") === "true" || o.checked === true ||
    (o.tagName.includes("-") && o.hasAttribute("checked"));

  // A role=radiogroup with no native radios: its options are role=radio elements or
  // custom elements named like "spl-radio", in the group's own tree or slotted from its host.
  function ariaRadios(group) {
    const host = rootOf(group).host;
    const scopes = [group];
    if (host) { scopes.push(host); const sr = shadowOf(host); if (sr) scopes.push(sr); }
    let opts = [];
    for (const sc of scopes) opts = opts.concat(deepAll("[role=radio]", sc));
    if (!opts.length) for (const sc of scopes) opts = opts.concat(deepAll("*", sc).filter((e) => /RADIO/.test(e.tagName) && e.tagName.includes("-") && !/GROUP/.test(e.tagName)));
    opts = [...new Set(opts)].filter((o) => o !== group);
    // keep the outermost of nested matches (a custom radio and its inner role=radio)
    return opts.filter((o) => !opts.some((p) => p !== o && p.contains(o)));
  }
  function radioLabel(o) {
    // a custom element's own (slotted) text is its label; its shadow may add icons or decoration
    const host = rootOf(o).host;
    const own = o.tagName.includes("-") ? clean(o.textContent)
      : host && host.tagName.includes("-") && /RADIO/.test(host.tagName) ? clean(host.textContent) : "";
    return clean(o.getAttribute("aria-label") || own || composedText(o) || o.getAttribute("label") || o.getAttribute("value") || "");
  }

  function collect() {
    const fields = [];
    const groups = new Map();
    for (const g of deepAll("[role=radiogroup]")) {
      if (isPanel(g) || deepAll("input[type=radio]", g).length) continue;
      const opts = ariaRadios(g).filter((o) => radioLabel(o));
      if (opts.length < 2 || !shown(g)) continue;
      const label = labelOf(g);
      fields.push({ type: "radio", aria: true, el: g, inputs: opts, label, options: opts.map(radioLabel),
        required: g.getAttribute("aria-required") === "true" || /\*\s*$/.test(label) });
    }
    const els = deepAll("input, textarea, select, [role=combobox], button[aria-haspopup=listbox]");
    for (const el of els) {
      if (isPanel(el) || el.disabled || el.readOnly && el.tagName !== "BUTTON") continue;
      const type = (el.type || "").toLowerCase();
      // react-select keeps an invisible required <input aria-hidden> next to each dropdown
      if (type !== "file" && (el.getAttribute("aria-hidden") === "true" || el.closest("[aria-hidden=true]"))) continue;
      if (el.closest("footer, [role=contentinfo]")) continue;
      if (el.tagName === "INPUT" && /^(hidden|submit|button|reset|image|search|password)$/.test(type)) continue;
      if (!visibleControl(el)) continue;
      if (el.tagName === "INPUT" && (type === "radio" || type === "checkbox")) {
        const key = type + ":" + rootKey(el) + ":" + (el.name || (el.closest("fieldset, [role=radiogroup], [role=group]") ? tag(el.closest("fieldset, [role=radiogroup], [role=group]")) : tag(el)));
        if (!groups.has(key)) { groups.set(key, { type, inputs: [] }); fields.push(groups.get(key)); }
        groups.get(key).inputs.push(el);
        continue;
      }
      // react-select and similar: the role=combobox element is a wrapper around an input
      if (el.getAttribute("role") === "combobox" && el.tagName !== "INPUT" && el.querySelector("input")) continue;
      let kind = "text";
      if (el.tagName === "SELECT") kind = "select";
      else if (el.tagName === "TEXTAREA") kind = "textarea";
      else if (type === "file") kind = "file";
      else if (el.tagName === "BUTTON") kind = "listbox";
      else if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete") === "list") kind = "combo";
      fields.push({ type: kind, el, label: labelOf(el), required: required(el) });
    }
    return fields.map((f) => {
      if (f.aria) return f;
      if (!f.inputs) {
        if (f.type === "select") f.options = [...f.el.options].map((o) => clean(o.text)).filter(Boolean);
        if (f.type === "combo") {
          const rs = reactSelect(f.el);
          if (rs) f.options = rsOptions(rs).slice(0, 80).map((o) => rsLabel(rs, o));
        }
        return f;
      }
      const options = f.inputs.map(optionLabel);
      if (f.inputs.length === 1) {
        // A lone box with a short label ("Yes", "I agree") belongs to the question above it;
        // one with a full sentence is its own question.
        const own = optionLabel(f.inputs[0]);
        const question = strictGroupLabel(f.inputs[0]) || (own.split(" ").length <= 4 ? groupLabel(f.inputs) : "");
        return { type: f.type, el: f.inputs[0], inputs: f.inputs, label: own || question,
          question, options, required: f.inputs[0].required };
      }
      const gl = groupLabel(f.inputs);
      return { type: f.type === "radio" ? "radio" : "checkboxes", el: f.inputs[0], inputs: f.inputs,
        label: gl, options, required: f.inputs.some((i) => i.required) || /\*\s*$/.test(gl) };
    }).filter((f) => f.label || f.type === "file");
  }

  async function scrape() {
    const found = collect();
    // Dropdowns that only render their options when opened: peek at them for the model.
    let peeked = 0;
    for (const f of found) {
      if (f.type !== "combo" || (f.options && f.options.length) || !controlledList(f.el) || peeked >= 25) continue;
      peeked++;
      try { f.options = await peekOptions(f.el); } catch (e) { /* leave it */ }
    }
    const fields = found.map((f) => ({
      label: f.type === "checkbox" && f.question && f.question !== f.label ? `${f.question}: ${f.label}` : f.label,
      type: f.type, required: !!f.required, options: f.options && f.options.length > 1 ? f.options : undefined,
    }));
    // innerText keeps line breaks, so the posting's headings and lists survive.
    // innerText stops at shadow roots, so add the text inside web components too.
    let raw = (document.body && document.body.innerText) || "";
    for (const host of deepAll("*")) {
      const sr = shadowOf(host);
      if (sr && host.id !== "apply-helper-host") raw += "\n" + [...sr.children].map((c) => c.innerText || "").join("\n");
      if (raw.length > 40000) break;
    }
    const text = raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 30000);
    return { text, fields };
  }

  // ---------- problem report: how this page's form is built (no typed values) ----------

  function debugInfo() {
    const attrs = (n) => [...n.attributes].filter((a) => a.name !== "value" && a.name !== "style")
      .map((a) => `${a.name}="${a.value.slice(0, 80)}"`).join(" ");
    const hosts = (n) => {
      const out = [];
      for (let r = rootOf(n); r && r.host && out.length < 6; r = rootOf(r.host)) out.push(`<${r.host.tagName.toLowerCase()} ${attrs(r.host)}>`);
      return out;
    };
    const controls = deepAll("input, textarea, select, [role=combobox], [role=radiogroup], [role=listbox], button[aria-haspopup]")
      .filter((el) => el.type !== "hidden").slice(0, 200);
    return {
      url: location.href.split("?")[0], top: IS_TOP,
      fields: collect().map((f) => ({ type: f.type, label: f.label, required: !!f.required, options: (f.options || []).slice(0, 15) })),
      controls: controls.map((el) => ({
        tag: el.tagName.toLowerCase(), attrs: attrs(el), shown: shown(el), filled: !!(el.value || el.checked),
        label: labelOf(el), byLabels: el.labels ? [...el.labels].map(txt) : [], host: hostLabel(el),
        nearby: nearbyLabel(el).slice(0, 200), shadowHosts: hosts(el),
        parent: (() => { const p = up(el); return p ? p.outerHTML.replace(/\svalue="[^"]*"/g, "").replace(/\s+/g, " ").slice(0, 400) : ""; })(),
      })),
    };
  }

  // ---------- filling ----------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clip = (s, n = 60) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 3) + "..." : s; };

  function setValue(el, value) {
    el.focus();
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype
      : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
  }

  const STATES = Object.fromEntries(("al alabama|ak alaska|az arizona|ar arkansas|ca california|co colorado|" +
    "ct connecticut|de delaware|fl florida|ga georgia|hi hawaii|id idaho|il illinois|in indiana|ia iowa|" +
    "ks kansas|ky kentucky|la louisiana|me maine|md maryland|ma massachusetts|mi michigan|mn minnesota|" +
    "ms mississippi|mo missouri|mt montana|ne nebraska|nv nevada|nh new hampshire|nj new jersey|" +
    "nm new mexico|ny new york|nc north carolina|nd north dakota|oh ohio|ok oklahoma|or oregon|" +
    "pa pennsylvania|ri rhode island|sc south carolina|sd south dakota|tn tennessee|tx texas|ut utah|" +
    "vt vermont|va virginia|wa washington|wv west virginia|wi wisconsin|wy wyoming|dc district of columbia")
    .split("|").map((p) => [p.slice(0, 2), p.slice(3)]));

  // "Austin, TX" -> "austin texas", so it finds "Austin, Texas, United States".
  function expandPlace(s) {
    const m = clean(s).match(/^(.+?),\s*([A-Za-z]{2})$/);
    return m && STATES[m[2].toLowerCase()] ? norm(m[1] + " " + STATES[m[2].toLowerCase()]) : null;
  }

  function bestOption(value, options) {
    let v = norm(value);
    if (ALIAS[v]) v = ALIAS[v];
    const place = expandPlace(value);
    if (place) {
      const P = place.split(" ");
      const hits = options.map((o, k) => [norm(o).split(" "), k]).filter(([w]) => P.every((p) => w.includes(p)));
      if (hits.length) return hits.sort((a, b) => a[0].length - b[0].length)[0][1];
    }
    const N = options.map((o) => { const n = norm(o); return ALIAS[n] || n; });
    let i = N.findIndex((n) => n === v);
    if (i >= 0) return i;
    i = N.findIndex((n) => n.length > 1 && (v.startsWith(n + " ") || n.startsWith(v + " ") || v.startsWith(n + ",")));
    if (i >= 0) return i;
    // "Prefer not to say" = "I don't wish to answer" = "Decline to self-identify"
    const DECLINE = /\b(prefer not|decline|don ?t wish|do not wish|don ?t want|do not want|not to (say|answer|disclose)|rather not|choose not)\b/;
    if (DECLINE.test(v)) {
      const hits = N.map((n, k) => (DECLINE.test(n) ? k : -1)).filter((k) => k >= 0);
      if (hits.length) return hits[0];
    }
    const yn = (s) => (s.match(/^(yes|no)\b/) || [])[1];
    if (yn(v)) {
      const hits = N.map((n, k) => (yn(n) === yn(v) ? k : -1)).filter((k) => k >= 0);
      if (hits.length === 1) return hits[0];
    }
    let best = -1, bestS = 0.5;
    N.forEach((n, k) => {
      if (/^(select|choose|please select|--)/.test(n) || !n) return;
      const s = dice(v, n);
      if (s > bestS) { best = k; bestS = s; }
    });
    if (best >= 0) return best;
    // "Bachelor of Science, Computer Science" -> "Bachelor's Degree": every telling word of
    // the option is in the value. The option covering the most words wins; a tie is a miss.
    const FILL = new Set(["degree", "", "level"]);
    const V = tokens(value);
    const cover = options.map((o) => {
      const T = [...tokens(o)].filter((w) => !FILL.has(w));
      return T.length && T.every((w) => V.has(w)) ? T.length : 0;
    });
    const top = Math.max(0, ...cover);
    return top && cover.filter((c) => c === top).length === 1 ? cover.indexOf(top) : -1;
  }

  const MARKETING = /\b(marketing|newsletter|sms|text messag\w*|promotion\w*|special offers|subscribe)\b/i;
  const CONSENT = /\b(agree|consent|certify|acknowledge|accept|attest|authori[sz]e|terms|privacy|policy|true and (complete|accurate))\b/i;

  function mark(el, how, note) {
    const colors = { filled: "#16a34a", kept: "#a1a1aa", decide: "#d97706", missing: "#dc2626", draft: "#7c3aed" };
    const target = /radio|checkbox/.test(el.type) ? (el.closest("fieldset, [role=radiogroup], [role=group]") || el.parentElement || up(el) || el)
      : el.getAttribute("role") === "combobox" ? ((el.closest("[class*=control]") || el).parentElement || el)
      : el.type === "file" ? (el.closest("[class*=upload], [class*=file]") || el.parentElement || el) : el;
    target.style.outline = `2px solid ${colors[how]}`;
    target.style.outlineOffset = "2px";
    if (note) target.title = "Apply Helper: " + note;
    return tag(target);
  }

  function visibleOptions() {
    return deepAll("[role=option], [role=listbox] li, .select__option")
      .filter((o) => shown(o) && !isPanel(o));
  }

  // The listbox a combobox controls (aria-controls/aria-owns), which may live in another shadow tree.
  function controlledList(el) {
    const id = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
    if (!id) return null;
    const r = rootOf(el);
    return (r.getElementById && r.getElementById(id)) || document.getElementById(id) ||
      deepAll(`[id="${id.replace(/"/g, '\\"')}"]`)[0] || null;
  }
  function listOptions(opener) {
    const lb = controlledList(opener);
    if (lb) {
      let o = deepAll("[role=option]", lb);
      const sr = shadowOf(lb);
      if (sr) o = o.concat(deepAll("[role=option]", sr));
      if (!o.length) o = [...lb.children];
      return o.filter((x) => shown(x) && txt(x));
    }
    return visibleOptions();
  }
  async function openList(opener) {
    opener.focus();
    opener.dispatchEvent(new FocusEvent("focus", { composed: true }));
    opener.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
    opener.click();
  }
  // Read a combobox's options without picking one (for the model). Leaves it as it was.
  async function peekOptions(opener) {
    await openList(opener);
    let opts = [];
    for (let t = 0; t < 5 && !opts.length; t++) { await sleep(150); opts = listOptions(opener); }
    const labels = opts.slice(0, 60).map(txt);
    opener.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
    opener.blur();
    return labels;
  }
  async function pickFromList(opener, value, typeIt) {
    const first = (expandPlace(value) ? value.split(",")[0] : value).slice(0, 40);
    // Typed search first, then a shorter one, then the whole list: a search for "Prefer not to say"
    // hides "I don't wish to answer", which the whole list shows.
    const queries = typeIt ? [first, first.split(/[ ,(]/)[0], ""] : [null];
    for (const q of [...new Set(queries)]) {
      await openList(opener);
      if (q !== null) { await sleep(120); setValue(opener, q); }
      for (let t = 0; t < 12; t++) {
        await sleep(200);
        const opts = listOptions(opener);
        if (!opts.length) continue;
        const i = bestOption(value, opts.map(txt));
        if (i < 0) break;
        opts[i].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
        opts[i].click();
        await sleep(200);
        return true;
      }
    }
    opener.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
    if (typeIt) setValue(opener, "");
    return false;
  }

  function attachFile(el, resume) {
    const bin = atob(resume.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], resume.name, { type: "application/pdf" }));
    el.files = dt.files;
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return el.files.length === 1;
  }

  function isEmpty(f) {
    const el = f.el;
    switch (f.type) {
      case "radio": case "checkboxes": return !f.inputs.some(isChecked);
      case "checkbox": return !el.checked;
      case "select": return el.selectedIndex <= 0 || !el.value || /^(select|choose|please)/i.test(clean(el.options[el.selectedIndex].text));
      case "file": return !el.files || !el.files.length;
      case "listbox": return /^(select|choose|please)/i.test(txt(el)) || !txt(el);
      case "combo": {
        const rs = reactSelect(el);
        if (rs) return !rsHasValue(rs);
        const box = el.closest("[class*=control]") || el.parentElement;
        return !el.value && !(box && box.querySelector("[class*=single-value], [class*=singleValue], [class*=multi-value]"));
      }
      default: return !el.value.trim();
    }
  }

  async function fillField(f, k, resume) {
    const el = f.el;
    const v = k.value;
    switch (f.type) {
      case "file":
        if (k.kind !== "file" || !resume || canon(f.label) === "cover") return false;
        return attachFile(el, resume);
      case "select": {
        const opts = [...el.options];
        const i = bestOption(v, opts.map((o) => o.text));
        if (i < 0) return false;
        setValue(el, opts[i].value);
        return true;
      }
      case "radio": {
        const i = bestOption(v, f.options);
        if (i < 0) return false;
        const o = f.inputs[i];
        // a custom radio may take the click on an inner element
        const inner = shadowOf(o) && shadowOf(o).querySelector("[role=radio], input, label, button");
        o.click();
        await sleep(80);
        if (!isChecked(o) && inner) { inner.click(); await sleep(80); }
        return isChecked(o) || f.inputs.some(isChecked);
      }
      case "checkboxes": {
        const wanted = v.split(/\s*[;,]\s*|\s+and\s+/).filter(Boolean);
        let any = false;
        for (const w of wanted) {
          const i = bestOption(w, f.options);
          if (i >= 0 && !f.inputs[i].checked) { f.inputs[i].click(); any = true; }
        }
        return any;
      }
      case "checkbox": {
        const yn = (norm(v).match(/^(yes|no|true|false|checked|unchecked)\b/) || [])[1];
        const own = optionLabel(el);
        // "Q4 2026 (October - December)" for a box labeled that way means tick it;
        // so does any agreeing answer to a consent box
        const named = own && (bestOption(v, [own]) === 0 || (CONSENT.test(own) && !MARKETING.test(own) && !/^(no|false|unchecked)/i.test(clean(v))));
        if (!yn && !named) return false;
        const want = named || yn === "yes" || yn === "true" || yn === "checked";
        if (el.checked !== want) el.click();
        return el.checked === want;
      }
      case "combo": {
        const r = await rsPick(el, v);
        return r === null ? pickFromList(el, v, true) : r;
      }
      case "listbox": return pickFromList(el, v, false);
      default:
        setValue(el, v);
        return el.value === v || !!el.value;
    }
  }

  async function fill(kit, resume) {
    const fields = collect();
    const report = { filled: [], kept: [], decide: [], drafts: [], missing: [], usedKit: [] };
    // Every pair above the gate, best first; each field and kit line used once.
    const pairs = [];
    fields.forEach((f, fi) => kit.fields.forEach((k, ki) => {
      if (k.kind === "file" && f.type !== "file") return;
      if (f.type === "file" && k.kind !== "file" && k.kind !== "decide" && k.kind !== "blank") return;
      let s = score(k.label, f.label);
      if (f.question) s = Math.max(s, score(k.label, f.question + " " + f.label));
      if (f.type === "file" && k.kind === "file" && canon(f.label) === "resume") s = Math.max(s, 0.9);
      if (s >= 0.55) pairs.push([s, fi, ki]);
    }));
    pairs.sort((a, b) => b[0] - a[0]);
    const fieldUsed = new Map(), kitUsed = new Set();
    for (const [, fi, ki] of pairs) {
      if (fieldUsed.has(fi) || kitUsed.has(ki)) continue;
      fieldUsed.set(fi, ki);
      kitUsed.add(ki);
    }
    // A lone resume upload with no kit line matched by label.
    const resumeKi = kit.fields.findIndex((k) => k.kind === "file");
    if (resume && resumeKi >= 0 && !kitUsed.has(resumeKi)) {
      const files = fields.map((f, i) => [f, i]).filter(([f, i]) => f.type === "file" && !fieldUsed.has(i) && canon(f.label) !== "cover");
      if (files.length === 1) { fieldUsed.set(files[0][1], resumeKi); kitUsed.add(resumeKi); }
    }

    for (let fi = 0; fi < fields.length; fi++) {
      const f = fields[fi];
      const label = f.question && f.type === "checkbox" ? `${f.question}: ${f.label}` : f.label;
      const ki = fieldUsed.get(fi);
      const k = ki === undefined ? null : kit.fields[ki];
      if (f.type === "checkbox" && MARKETING.test(label)) continue; // never opt in to marketing
      // any answer that is not a "no" (the model may echo the box's own wording)
      const saysYes = k && (k.kind === "suggest" || k.kind === "text") && !!clean(k.value) &&
        !/^(no|false|unchecked|do not|don't|leave)/i.test(clean(k.value));
      if (f.type === "checkbox" && CONSENT.test(label) && !saysYes) {
        if (isEmpty(f)) report.decide.push({ label, note: "Consent box: read it and tick it yourself", hid: mark(f.el, "decide", "tick this yourself") });
        continue;
      }
      if (!k) {
        if (f.required && isEmpty(f)) report.missing.push({ label, hid: mark(f.el, "missing", "not in the kit") });
        continue;
      }
      report.usedKit.push(ki);
      if (k.kind === "blank") continue;
      if (k.kind === "decide") {
        if (isEmpty(f)) report.decide.push({ label, note: k.note, hid: mark(f.el, "decide", k.note) });
        continue;
      }
      if (!isEmpty(f)) { report.kept.push({ label, hid: mark(f.el, "kept", "already filled; left as is") }); continue; }
      let ok = false;
      try { ok = await fillField(f, k, resume); } catch (e) { ok = false; }
      if (ok && k.kind === "draft") report.drafts.push({ label, note: "AI-written draft: read it", hid: mark(f.el, "draft", "AI-written draft: read and edit before you submit") });
      else if (ok && k.kind === "suggest") report.drafts.push({ label, note: `Picked "${clip(k.value)}"${k.note ? ": " + k.note : ""}`, hid: mark(f.el, "draft", "AI suggestion: " + (k.note || k.value)) });
      else if (ok) report.filled.push({ label, hid: mark(f.el, "filled") });
      else report.decide.push({ label, note: `Could not set it. Kit says: ${k.value}`, hid: mark(f.el, "decide", "kit says: " + k.value) });
      await sleep(40);
    }
    return report;
  }

  // ---------- panel (top frame only) ----------
  // One card, five states: idle, working, blocked, error, done. Everything lives in a
  // closed shadow root so the page's styles never touch it and ours never leak.

  let panel = null;

  const ICON = globalThis.APPLY_HELPER_ICONS;

  const PANEL_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .root {
      --bg: #ffffff; --bg-2: #f6f6f7; --bg-3: #eeeef0; --line: #e4e4e7; --line-2: #d4d4d8;
      --fg: #18181b; --fg-2: #52525b; --fg-3: #8b8b94;
      --accent: #4f46e5; --accent-2: #4338ca; --accent-bg: #eef2ff; --accent-fg: #ffffff;
      --green: #16a34a; --green-bg: #ecfdf3; --violet: #7c3aed; --violet-bg: #f5f3ff;
      --amber: #d97706; --amber-bg: #fffbeb; --red: #dc2626; --red-bg: #fef2f2;
      --shadow: 0 1px 2px rgba(16,24,40,.06), 0 12px 32px -4px rgba(16,24,40,.18), 0 0 0 1px rgba(16,24,40,.06);
      font: 13px/1.45 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif;
      color: var(--fg); -webkit-font-smoothing: antialiased;
    }
    @media (prefers-color-scheme: dark) {
      .root {
        --bg: #18181b; --bg-2: #202024; --bg-3: #2a2a2f; --line: #2e2e33; --line-2: #3f3f46;
        --fg: #f4f4f5; --fg-2: #b4b4bd; --fg-3: #80808a;
        --accent: #818cf8; --accent-2: #a5b4fc; --accent-bg: rgba(129,140,248,.14); --accent-fg: #11111a;
        --green: #4ade80; --green-bg: rgba(74,222,128,.12); --violet: #a78bfa; --violet-bg: rgba(167,139,250,.14);
        --amber: #fbbf24; --amber-bg: rgba(251,191,36,.12); --red: #f87171; --red-bg: rgba(248,113,113,.12);
        --shadow: 0 0 0 1px rgba(255,255,255,.06), 0 16px 40px -6px rgba(0,0,0,.6);
      }
    }
    svg { width: 16px; height: 16px; display: block; flex: none; }
    button { font: inherit; color: inherit; cursor: pointer; }
    button:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    .card { width: 360px; max-height: min(640px, calc(100vh - 32px)); display: flex; flex-direction: column;
      background: var(--bg); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden;
      animation: rise .18s ease-out; }
    @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(.99); } to { opacity: 1; transform: none; } }

    header { display: flex; align-items: center; gap: 10px; padding: 12px 12px 12px 14px; border-bottom: 1px solid var(--line); }
    .logo { color: var(--accent); width: 26px; height: 26px; }
    .logo svg { width: 26px; height: 26px; }
    .titles { flex: 1; min-width: 0; }
    .t1 { font-weight: 600; font-size: 13.5px; letter-spacing: -.005em; }
    .t2 { color: var(--fg-3); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .icon-btn { width: 28px; height: 28px; display: grid; place-items: center; border: 0; background: transparent;
      border-radius: 7px; color: var(--fg-2); }
    .icon-btn:hover { background: var(--bg-3); color: var(--fg); }

    .menu { position: absolute; right: 44px; top: 46px; min-width: 210px; background: var(--bg); border-radius: 10px;
      box-shadow: var(--shadow); padding: 4px; z-index: 2; }
    .menu[hidden] { display: none; }
    .menu button { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 0; background: none;
      border-radius: 7px; text-align: left; color: var(--fg); }
    .menu button:hover { background: var(--bg-2); }
    .menu button svg { color: var(--fg-2); }
    .menu hr { border: 0; border-top: 1px solid var(--line); margin: 4px 2px; }

    main { overflow: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 14px; overscroll-behavior: contain; }
    main > * { flex: none; }
    footer { padding: 12px 14px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px; background: var(--bg); }
    .hint { color: var(--fg-3); font-size: 11.5px; text-align: center; }

    h2 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -.01em; }
    p { margin: 0; color: var(--fg-2); }

    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 36px; padding: 0 14px;
      border-radius: 9px; border: 1px solid var(--line-2); background: var(--bg); font-weight: 500; transition: background .12s, border-color .12s, transform .06s; }
    .btn:hover { background: var(--bg-2); }
    .btn:active { transform: translateY(1px); }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
    .btn.primary:hover { background: var(--accent-2); border-color: var(--accent-2); }
    .btn.block { width: 100%; }
    .btn.sm { height: 30px; padding: 0 10px; font-size: 12.5px; border-radius: 8px; }
    .btn svg { width: 15px; height: 15px; }
    .row { display: flex; gap: 8px; }
    .row > .btn { flex: 1; }

    .hero { display: flex; flex-direction: column; gap: 6px; }
    .hero .badge { align-self: flex-start; display: inline-flex; gap: 6px; align-items: center; color: var(--accent);
      background: var(--accent-bg); padding: 3px 8px 3px 6px; border-radius: 999px; font-size: 11.5px; font-weight: 500; }
    .hero .badge svg { width: 13px; height: 13px; }
    .stack { display: flex; flex-direction: column; gap: 8px; }

    /* progress */
    .steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .step { display: flex; align-items: center; gap: 10px; padding: 7px 0; color: var(--fg-3); }
    .step .dot { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; border: 1.5px solid var(--line-2); flex: none; }
    .step.done { color: var(--fg-2); }
    .step.done .dot { background: var(--green); border-color: var(--green); color: #fff; }
    .step.done .dot svg { width: 12px; height: 12px; }
    .step.active { color: var(--fg); font-weight: 500; }
    .step.active .dot { border-color: var(--accent); border-top-color: transparent; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .sub-msg { color: var(--fg-3); font-size: 12px; padding-left: 30px; margin-top: -4px; }
    .timer { font-variant-numeric: tabular-nums; color: var(--fg-3); font-size: 12px; }
    .bar { height: 3px; background: var(--bg-3); border-radius: 99px; overflow: hidden; }
    .bar i { display: block; height: 100%; width: 40%; background: var(--accent); border-radius: 99px; animation: slide 1.4s ease-in-out infinite; }
    @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(260%); } }

    /* notices */
    .note { display: flex; gap: 10px; padding: 10px 12px; border-radius: 10px; font-size: 12.5px; }
    .note svg { margin-top: 1px; }
    .note.warn { background: var(--amber-bg); color: var(--fg); } .note.warn svg { color: var(--amber); }
    .note.err { background: var(--red-bg); color: var(--fg); } .note.err svg { color: var(--red); }
    .note b { display: block; font-weight: 600; margin-bottom: 2px; }
    .note ul { margin: 6px 0 0; padding-left: 16px; color: var(--fg-2); }

    /* job */
    .job { display: flex; align-items: flex-start; gap: 10px; }
    .job .co { width: 36px; height: 36px; border-radius: 9px; background: var(--bg-3); display: grid; place-items: center;
      font-weight: 600; color: var(--fg-2); flex: none; font-size: 14px; }
    .job .meta { min-width: 0; flex: 1; }
    .job .role { font-weight: 600; font-size: 14px; line-height: 1.3; }
    .job .emp { color: var(--fg-2); font-size: 12.5px; }
    .pill { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px; border-radius: 99px;
      font-size: 11px; font-weight: 500; background: var(--bg-3); color: var(--fg-2); white-space: nowrap; }
    .pill.ok { background: var(--green-bg); color: var(--green); }
    .pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

    /* stats */
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .stat { border: 1px solid var(--line); border-radius: 10px; padding: 8px 7px 7px 9px; text-align: left; background: var(--bg); min-width: 0; }
    .stat:hover { border-color: var(--line-2); background: var(--bg-2); }
    .stat .n { font-size: 18px; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1.2; }
    .stat .k { font-size: 11px; color: var(--fg-3); display: flex; align-items: center; gap: 5px; white-space: nowrap; }
    .stat .k::before { content: ""; width: 7px; height: 7px; border-radius: 2px; background: var(--c); flex: none; }
    .stat[data-zero] .n { color: var(--fg-3); }

    /* resume */
    .doc { display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--line); border-radius: 11px; }
    .doc .ico { width: 34px; height: 40px; border-radius: 6px; background: var(--red-bg); color: var(--red); display: grid; place-items: center; flex: none; }
    .doc .ico svg { width: 18px; height: 18px; }
    .doc .nm { font-weight: 500; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .doc .ds { color: var(--fg-3); font-size: 11.5px; }
    .doc .info { flex: 1; min-width: 0; }

    /* lists */
    details { border: 1px solid var(--line); border-radius: 11px; overflow: hidden; }
    summary { list-style: none; display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: pointer; font-weight: 550; user-select: none; }
    summary::-webkit-details-marker { display: none; }
    summary .chev { color: var(--fg-3); transition: transform .15s; }
    details[open] summary .chev { transform: rotate(90deg); }
    summary .sw { width: 8px; height: 8px; border-radius: 2px; background: var(--c); }
    summary .cnt { margin-left: auto; color: var(--fg-3); font-weight: 500; font-variant-numeric: tabular-nums; font-size: 12px; }
    .items { border-top: 1px solid var(--line); }
    .item { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 9px 12px 9px 28px; position: relative; }
    .item + .item { border-top: 1px solid var(--line); }
    .item:hover { background: var(--bg-2); }
    .item .q { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--fg); }
    .item .a { color: var(--fg-3); font-size: 12px; margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .item::before { content: ""; position: absolute; left: 13px; top: 15px; width: 6px; height: 6px; border-radius: 50%; background: var(--c); }
    .item.static { cursor: default; }
    .legend { display: flex; flex-wrap: wrap; gap: 10px; color: var(--fg-3); font-size: 11px; justify-content: center; }
    .legend span { display: inline-flex; align-items: center; gap: 5px; }
    .legend span::before { content: ""; width: 7px; height: 7px; border-radius: 2px; background: var(--c); }
    .c-green { --c: var(--green); } .c-violet { --c: var(--violet); } .c-amber { --c: var(--amber); } .c-red { --c: var(--red); } .c-gray { --c: var(--fg-3); }

    /* minimized */
    .fab { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px 0 8px; border-radius: 999px; border: 0;
      background: var(--bg); box-shadow: var(--shadow); font-weight: 550; }
    .fab .logo, .fab .logo svg { width: 24px; height: 24px; }
    .fab .dotx { width: 8px; height: 8px; border-radius: 50%; background: var(--c, var(--fg-3)); }
    .toast { position: absolute; left: 50%; bottom: 72px; transform: translateX(-50%); background: var(--fg); color: var(--bg);
      padding: 7px 12px; border-radius: 8px; font-size: 12px; white-space: nowrap; animation: rise .15s ease-out; }
  `;

  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "icon") n.append(globalThis.APPLY_HELPER_SVG(v));
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c);
    return n;
  }
  const icon = (name) => globalThis.APPLY_HELPER_SVG(name);
  const send = (msg) => browser.runtime.sendMessage(msg).catch((e) => ({ ok: false, error: e.message }));

  const STEPS = [
    ["read", "Reading the posting and form"],
    ["ai", "Tailoring with AI"],
    ["build", "Building your one-page resume"],
    ["fill", "Filling the form"],
  ];

  function ensurePanel() {
    if (!IS_TOP) return null;
    if (panel) { panel.host.style.display = ""; return panel; }
    const host = document.createElement("div");
    host.id = "apply-helper-host";
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    root.append(style);
    const wrap = h("div", { class: "root" });
    root.append(wrap);
    document.documentElement.appendChild(host);
    panel = { host, root, wrap, state: "idle", last: null, timer: null, collapsed: false };
    renderIdle();
    return panel;
  }

  function frame(sub, body, foot) {
    const p = panel;
    clearInterval(p.timer);
    p.wrap.textContent = "";
    if (p.collapsed) return renderFab();
    const menu = h("div", { class: "menu", hidden: true, role: "menu" },
      h("button", { role: "menuitem", onclick: () => act({ type: "scan" }) }, icon("refresh"), "Tailor and fill again"),
      h("button", { role: "menuitem", onclick: () => act({ type: "fill" }) }, icon("list"), "Fill with saved answers"),
      h("hr"),
      h("button", { role: "menuitem", onclick: reportProblem }, icon("bug"), "Report a problem"),
      h("button", { role: "menuitem", onclick: () => send({ type: "openOptions" }) }, icon("gear"), "Settings and history"));
    const card = h("div", { class: "card", role: "dialog", "aria-label": "Apply Helper" },
      h("header", {},
        h("div", { class: "logo", icon: "logo" }),
        h("div", { class: "titles" }, h("div", { class: "t1" }, "Apply Helper"), h("div", { class: "t2" }, sub)),
        h("button", { class: "icon-btn", title: "More", "aria-haspopup": "menu", onclick: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; } , icon: "more" }),
        h("button", { class: "icon-btn", title: "Minimize", onclick: () => { p.collapsed = true; rerender(); }, icon: "minus" })),
      menu,
      h("main", {}, body),
      foot ? h("footer", {}, foot) : null);
    card.addEventListener("click", () => { menu.hidden = true; });
    p.wrap.append(card);
  }

  function renderFab() {
    const p = panel;
    const r = p.last && p.last.kind === "report" ? p.last.data : null;
    const need = r ? r.decide.length + r.missing.length : 0;
    const color = p.state === "working" ? "var(--accent)" : need ? "var(--amber)" : r ? "var(--green)" : "var(--fg-3)";
    const label = p.state === "working" ? "Working..." : r ? (need ? `${need} need you` : "All filled") : "Apply Helper";
    p.wrap.append(h("button", { class: "fab", style: `--c:${color}`, onclick: () => { p.collapsed = false; rerender(); } },
      h("div", { class: "logo", icon: "logo" }), label, h("span", { class: "dotx" })));
  }

  function rerender() {
    const l = panel.last;
    if (!l) return renderIdle();
    ({ status: () => showStatus(l.data), report: () => showReport(l.data), idle: renderIdle })[l.kind]();
  }

  function toast(msg) {
    const t = h("div", { class: "toast" }, msg);
    panel.wrap.append(t);
    setTimeout(() => t.remove(), 2600);
  }

  async function act(msg) {
    const r = await send(msg);
    if (r && !r.ok && r.error) showStatus({ state: "error", message: r.error });
    return r;
  }

  async function reportProblem() {
    const r = await send({ type: "debugReport" });
    toast(r && r.ok ? `Saved ${r.file} to Downloads` : "Could not save the report");
  }

  function renderIdle() {
    panel.state = "idle";
    panel.last = { kind: "idle" };
    frame("Ready on this page",
      h("div", { class: "hero" },
        h("span", { class: "badge" }, icon("sparkle"), "AI-tailored application"),
        h("h2", {}, "Tailor and fill this application"),
        h("p", {}, "Reads the posting and form, builds a one-page resume from your profile, and fills every field. You review and submit.")),
      h("div", { class: "stack" },
        h("button", { class: "btn primary block", onclick: () => act({ type: "scan" }) }, icon("sparkle"), "Tailor & fill"),
        h("button", { class: "btn block", onclick: () => act({ type: "fill" }) }, "Fill with saved answers")));
  }

  function showStatus(st) {
    const p = ensurePanel();
    if (!p) return;
    p.last = { kind: "status", data: st };
    if (st.state === "working" && p.state !== "working") p.started = Date.now();
    p.state = st.state;
    if (st.state === "working") return renderWorking(st);
    if (st.state === "blocked") return renderBlocked(st);
    if (st.state === "error") return renderError(st);
  }

  function renderWorking(st) {
    const p = panel;
    p.started = p.started || Date.now();
    const idx = Math.max(0, STEPS.findIndex(([k]) => k === (st.step || "read")));
    const timer = h("span", { class: "timer" }, "0:00");
    const tick = () => {
      const s = Math.floor((Date.now() - p.started) / 1000);
      timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    };
    frame("Working on this application",
      [h("div", { class: "row", style: "align-items:center;justify-content:space-between" }, h("h2", {}, "Preparing your application"), timer),
        h("div", { class: "bar" }, h("i")),
        h("ol", { class: "steps" }, STEPS.map(([k, label], i) => [
          h("li", { class: "step " + (i < idx ? "done" : i === idx ? "active" : "") },
            h("span", { class: "dot", icon: i < idx ? "check" : null }), label),
          i === idx && st.message ? h("div", { class: "sub-msg" }, st.message) : null]))],
      h("div", { class: "hint" }, "You can keep reading. Nothing is submitted."));
    tick();
    p.timer = setInterval(tick, 1000);
  }

  function renderBlocked(st) {
    panel.started = null;
    frame(st.already ? "Already applied" : "Check the requirements",
      [h("div", { class: "note warn" }, icon("alert"), h("div", {},
        h("b", {}, st.already ? "You already applied to this posting" : "You may not meet some must-have requirements"),
        st.message,
        st.reasons && st.reasons.length ? h("ul", {}, st.reasons.map((r) => h("li", {}, r))) : null))],
      h("div", { class: "row" },
        h("button", { class: "btn", onclick: renderIdle }, "Cancel"),
        h("button", { class: "btn primary", onclick: () => act({ type: "continue", id: st.id, rescan: !!st.already }) },
          st.already ? "Tailor again" : "Tailor anyway")));
  }

  function renderError(st) {
    panel.started = null;
    const setup = /API key|profile/i.test(st.message || "");
    frame("Something went wrong",
      h("div", { class: "note err" }, icon("alert"), h("div", {}, h("b", {}, setup ? "Finish setting up first" : "That didn't work"), st.message)),
      h("div", { class: "row" },
        setup ? h("button", { class: "btn primary", onclick: () => send({ type: "openOptions" }) }, icon("gear"), "Open settings")
          : h("button", { class: "btn primary", onclick: () => act({ type: "scan" }) }, icon("refresh"), "Try again"),
        h("button", { class: "btn", onclick: reportProblem }, "Report")));
  }

  function showReport(r) {
    const p = ensurePanel();
    if (!p) return;
    p.last = { kind: "report", data: r };
    p.state = "done";
    p.started = null;
    const hd = r.header || {};
    const applied = /^applied/i.test(hd.status || "");
    const empty = !r.filled.length && !r.decide.length && !r.drafts.length && !r.missing.length && !r.kept.length;
    const goto = (it) => it.hid && send({ type: "focus", hid: it.hid, frameId: it.frameId });

    const sections = {};
    const section = (key, title, color, items, note, open) => {
      if (!items.length) return null;
      const d = h("details", { class: color, open: open || null },
        h("summary", {}, h("span", { class: "chev", icon: "chevron" }), h("span", { class: "sw" }), title, h("span", { class: "cnt" }, String(items.length))),
        h("div", { class: "items" }, items.map((it) => h("button", { class: "item " + (it.hid ? "" : "static"), onclick: () => goto(it), title: it.hid ? "Show this field" : null },
          h("div", { class: "q" }, String(it.label || "").replace(/\s*\*\s*$/, "")), note(it) ? h("div", { class: "a" }, note(it)) : null))));
      sections[key] = d;
      return d;
    };
    const stat = (key, label, color, n) => h("button", { class: "stat " + color, "data-zero": n ? null : true,
      onclick: () => { const d = sections[key]; if (d) { d.open = true; d.scrollIntoView({ block: "nearest", behavior: "smooth" }); } } },
      h("div", { class: "n" }, String(n)), h("div", { class: "k" }, label));

    const notices = [];
    if (empty) notices.push(["err", "No form fields found", "Open the application form itself (it may be behind an Apply button), then try again."]);
    if (r.stale) notices.push(["warn", "These answers are from an older version", "Tailor again for answers that match this form."]);
    else if (r.poorMatch && !empty) notices.push(["warn", "Saved answers don't match this page", "This page has different questions. Tailor again to answer them."]);
    if (applied) notices.push(["warn", `Marked as ${hd.status.toLowerCase()}`, "You already submitted this application."]);

    const lists = [
      section("decide", "Needs you", "c-amber", r.decide, (it) => it.note, true),
      section("missing", "Required, not answered", "c-red", r.missing, () => "", true),
      section("drafts", "Review AI choices", "c-violet", r.drafts, (it) => it.note, !r.decide.length && !r.missing.length),
      section("filled", "Filled from your profile", "c-green", r.filled.concat(r.kept.map((k) => Object.assign({}, k, { note: "Already filled; left as is" }))), (it) => it.note || "", false),
      section("notclaimed", "Not claimed on your resume", "c-gray", r.notClaimed.map((n) => ({ label: n.what, note: n.why })), (it) => it.note, false),
      section("warnings", "Resume notes", "c-gray", (r.warnings || []).map((w) => ({ label: w })), () => "", false),
    ].filter(Boolean);

    const company = (hd.employer || "?").trim();
    frame(r.fileName ? "Ready for your review" : "Filled",
      [h("div", { class: "job" },
        h("div", { class: "co" }, company.slice(0, 1).toUpperCase()),
        h("div", { class: "meta" }, h("div", { class: "role" }, hd.title || "Application"), h("div", { class: "emp" }, company)),
        h("span", { class: "pill " + (applied ? "ok" : "") }, applied ? "Applied" : "Not submitted")),
       notices.map(([k, b, t]) => h("div", { class: "note " + k }, icon("alert"), h("div", {}, h("b", {}, b), t,
         k !== "err" || empty ? h("div", { style: "margin-top:8px" }, h("button", { class: "btn sm", onclick: () => act({ type: "scan" }) }, icon("refresh"), "Tailor again")) : null))),
       h("div", { class: "stats" },
         stat("filled", "Filled", "c-green", r.filled.length + r.kept.length),
         stat("drafts", "Review", "c-violet", r.drafts.length),
         stat("decide", "Needs you", "c-amber", r.decide.length),
         stat("missing", "Missing", "c-red", r.missing.length)),
       r.fileName ? h("div", { class: "doc" },
         h("div", { class: "ico", icon: "file" }),
         h("div", { class: "info" }, h("div", { class: "nm", title: r.fileName }, r.fileName), h("div", { class: "ds" }, "Tailored for this role \u00b7 attached")),
         h("button", { class: "icon-btn", title: "View", onclick: () => send({ type: "open", id: r.id }), icon: "eye" }),
         h("button", { class: "icon-btn", title: "Download", onclick: () => send({ type: "download", id: r.id }), icon: "download" })) : null,
       lists,
       h("div", { class: "legend" }, h("span", { class: "c-green" }, "From your profile"), h("span", { class: "c-violet" }, "AI choice"),
         h("span", { class: "c-amber" }, "Needs you"), h("span", { class: "c-red" }, "Missing"))],
      [applied ? null : h("button", { class: "btn primary block", onclick: async () => {
        const d = new Date();
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        await send({ type: "setStatus", id: r.id, status: "Applied on " + ds });
        r.header = Object.assign({}, hd, { status: "Applied on " + ds });
        showReport(r);
        toast("Marked as submitted");
      } }, icon("check"), "I submitted it"),
       h("div", { class: "hint" }, applied ? "Saved in your application history." : "Review the page, press the site's Submit, then mark it here.")]);
  }

  browser.runtime.onMessage.addListener((msg) => {
    switch (msg.type) {
      case "scrape": return scrape();
      case "debug": return Promise.resolve(debugInfo());
      case "fill": return fill(msg.kit, msg.resume);
      case "status": showStatus(msg.status); return;
      case "report": showReport(msg.report); return;
      case "show": if (ensurePanel()) { panel.collapsed = false; rerender(); } return;
      case "focus": {
        const t = deepAll(`[${HID}="${msg.hid}"]`)[0];
        if (t) {
          t.scrollIntoView({ block: "center", behavior: "smooth" });
          if (t.focus) t.focus({ preventScroll: true });
          const prev = t.style.boxShadow;
          t.style.transition = "box-shadow .3s";
          t.style.boxShadow = "0 0 0 6px rgba(79,70,229,.35)";
          setTimeout(() => { t.style.boxShadow = prev; }, 1400);
        }
        return;
      }
    }
  });
})();
