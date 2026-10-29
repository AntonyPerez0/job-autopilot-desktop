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
4. `tailor.js` (`candidates`, `fit`): the one-page fill takes one more line from each
   entry in turn instead of every line of the first entry first, and tries up to
   40 additions instead of 12, so a long current job does not crowd out the others
   and leave the page part empty.
5. `tailor.js` (`fit`): filling the page stops at 5 lines for the first job and 3 for each
   other entry, as recruiters expect (docs/resume-research.md); a layout or plan that asks
   for more keeps them. If more than about 20 lines are still empty after that, each entry
   other than the first job may take one more line.

6. `resume_pdf.js` (`render`, `doc.scale`) and `tailor.js` (`fit`): a resume that leaves more than
   about 10 lines empty is set up to 18% larger and more open instead, as long as it still fits.

7. `resume_pdf.js` (`render`): an entry without an employer (volunteer work, say) shows its title
   alone, without a trailing comma.

8. `tailor.js` (`chat`): an optional `seed`, sent with the request, so the same question gets the same
   answer from providers that support one (the app asks at temperature 0 with a fixed seed).

9. `resume_pdf.js` (`render`, `doc.spread`) and `tailor.js` (`fit`): a resume still short after setting it
   larger spreads the rest of the space between sections and entries, within limits, so the page doesn't
   stop two thirds of the way down; the largest setting is 1.22.

10. `tailor.js` (`parseJSON`): the model's reply is read up to 400,000 characters, and the JSON inside
    other text is found from the first `{` to the last `}` with indexOf (the same span `/\{[\s\S]*\}/`
    matched, without its quadratic time on a reply full of braces). Security audit 3.6.

To update: copy the new files over these, reapply the ten edits, run `npm test`.
