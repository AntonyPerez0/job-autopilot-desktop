# Vendored: Apply Helper add-on scripts

These files come from the Apply Helper Firefox add-on (by the same author),
copied at commit `584d5a5`. They run unchanged inside a Node `vm` (see
`core/engine.js`) and inside each page of the application browser
(`content.js`, `icons.js`), so the desktop app tailors, builds the PDF and
fills forms exactly as the add-on does.

| File | What it does |
|---|---|
| `tailor.js` | tailoring prompt, plan checks, one-page fit loop, form kit, `profileFromText` |
| `resume_pdf.js` | the one-page resume PDF (pdf-lib) |
| `profile.js` | profile format, `Profile.EXAMPLE`, validation, text checks |
| `content.js`, `icons.js` | reads and fills application forms in every frame and shadow root |
| `lib/pdf-lib.min.js` | pdf-lib 1.17, MIT (see `lib/pdf-lib.LICENSE.md`) |

Local changes, kept as small as possible:

1. `tailor.js`: the OpenRouter attribution headers (`HTTP-Referer`, `X-Title`)
   name this app instead of the add-on.
2. `tailor.js`: an example employer in one prompt line is a placeholder
   ("Acme Corp").
3. `content.js`: the example city in one comment is a neutral one.

To update: copy the new files over these, reapply the three edits, run `npm test`.
