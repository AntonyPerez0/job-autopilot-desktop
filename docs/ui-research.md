# UI research: making Job Autopilot intuitive

Research notes for the next round of UI work, done 8 Nov 2026 at commit `b329c35`. It has three parts:

- **[Audit]** A walk through the app's own screens and code (setup, Overview, lists, the job panel, Settings, Resume,
  Help), using the test suite's screenshots at a small laptop window (945 × 640) and a large one (2200 px). Code
  references are `file:line` at that commit. The claims that matter most were checked again in the code.
- **[Guidance]** What the organisations that own UX guidance recommend: Microsoft's Guidelines for Human-AI
  Interaction (HAX), Google's People + AI Guidebook (PAIR), Apple's Human Interface Guidelines, the GOV.UK Design
  System and Service Manual, the W3C's cognitive accessibility note (COGA) and WCAG 2.2, Material Design 3, IBM's
  Carbon. Nielsen Norman Group (NN/g) is research-based, not a standards body, and is marked as such.
- **[Products]** How other job tools show the same things, from their own help centres, product pages and app-store
  listings: Teal, Huntr, Simplify, Careerflow, Jobright, AIApply, LoopCV, LazyApply, Sonara, LinkedIn, Indeed,
  Glassdoor. Only public pages were read; no logged-in screens.

Two real-world signals started this: a user stayed in practice mode for two weeks with **26 practice applications
filled and none sent** (daily limit 2), and **most of their skipped jobs were skipped for years of experience**.

---

## 1. What's behind the two signals [Audit]

**Practice mode never ends, and doesn't look like practice.**

- Once one practice run counts as checked (pressing **Send this one for real** or **Send them for real**, or starting
  to send and switching back), the worker keeps filling practice runs with no end. Practice runs don't count toward
  the daily limit: `appliedToday()` counts only rows with a submit time (`core/db.js`), and a practice run has none.
  That's how 26 pile up at a limit of 2.
- The only reminder is a non-urgent To do row near the bottom, "Practice mode is on", with no count
  (`ui/index.html:969`).
- While a practice run is being filled, the status chip and progress card say "Applying to {company}" and list
  **Submit** and **Confirmation** steps (`ui/index.html:224, 269-273`). The Overview's subtitle says jobs are "found
  and applied to automatically".
- The mode switch at the bottom left reads "Send for real (off: practice)", and Pause's opposite is labelled
  "Resume", like the Resume page.

**Years of experience decide most skips, and the rule is hidden.**

- `maxYearsRequired` defaults to **3** (`core/store.js:74`), whatever the person's own experience. It's a hard rule
  in the AI screening (`core/engine.js:131`) and drops postings that state more before they're even listed
  (`core/discover.js:247`).
- Its only control, "Most years of experience a job may require", is under More options, which Simple mode hides
  (`ui/forms.js:1181-1187`, `ui/style.css:478`). An experienced driver never sees a "4+ years" job and is never told
  why.

**The reasons can't be reached in Simple mode.** The To do row's **See why** opens Skipped, which Simple mode hides,
so the app bounces straight back to the Overview. That row also disappears as soon as anything is queued, filled or
applied.

## 2. Other problems the audit found [Audit]

High:

- **The job panel's top doesn't scroll.** Only the tab area scrolls (`ui/style.css:242, 259`). Chips, the status
  line, replies, people you know, "Where it stands" and the buttons can push the tabs off a 640-720 px tall window,
  where nothing can reach them.
- **Too many buttons when a decision is due.** A practice run's panel can show nine buttons, three of which lead to
  sending it (`ui/index.html:487-503`). The panel never says what to check.
- **Write my resume replaces the resume by default.** With a resume already there, "Add to my current resume
  instead of starting a new one" starts unticked (`ui/forms.js:466`). Separately, **Use the example profile to try
  the app** sits on the Resume page and replaces the person's resume without asking.
- **Settings saving is unpredictable.** Most sections save only with **Save changes** at the end of the section,
  1,500-2,000 px below the job titles, and leaving the page drops edits without a word. Some controls in the same
  sections save at once. Job titles start about 950 px down, below Updates and Appearance.
- **Narrow windows lose the controls.** Below 860 CSS px the sidebar goes, and with it Pause, the mode switch and
  Simple/Advanced (`ui/style.css:541-546`). Text size works by zooming, so "Largest" on a 1366 px laptop at 125%
  Windows scaling gets there.
- **Simple mode hides places the app sends people to:** Skipped (from To do and Help), Settings > Job site accounts
  (a Workday reason says to turn it on), Settings > Your data (from Help), the years cap, the daily limit.
- **Setup errors go stale.** A red message stays after the problem is fixed, and on long steps it sits under the
  sticky Back/Continue bar, out of sight.

Medium:

- **To do isn't first and isn't in order.** The progress card and "This week" come first, so a small window shows
  one or two rows. "Follow up on 1 application" ranks above "Add your street address", which stops every form.
  Stopped applications other than unanswered questions (an error, a CAPTCHA) get no row.
- **Many names for one thing:** practice mode, practice run, practice application, filled application, dry run;
  Start sending for real, Send for real, go live, "went live"; Needs attention, needs your answer.
- **Jargon** in lists and subtitles: "Board", "Screened as a fit", "boards that need an account".
- **Too much amber and red.** Practice runs and Apply yourself share Needs attention's amber; Paused is red, like an
  error. List pages can stack up to six urgent banners.
- **Look-alike actions:** "Skip this job", "Skip this job instead" and "Not this kind of work"; "Try again" beside
  "Save my answers and try again"; **Finish it with me** opens a dialog titled "Finish it with the app".
- **Something's wrong loses the place.** Each choice closes the panel and lands at the top of a long Settings
  section or the Resume page, with no pointer to the wrong answer and no way back to the job.
- **Help** has no "Why isn't anything being sent?" or "Why were so many jobs skipped?", and it points to
  "Settings > Running", which doesn't exist (`ui/index.html:1110`).

## 3. What the guidance says

**Make the mode impossible to miss, and give practice a clear end.**

- Mode errors come from unclear status. Show the mode with at least two visual indicators and say what it does.
  [NN/g] <https://www.nngroup.com/articles/modes/>
- "Start users with the lowest level of automation, and progressively increase", in small steps that can be dialled
  back. [Guidance, PAIR] <https://pair.withgoogle.com/guidebook/patterns>
- "Give them an explicit goal and show their progress… Immediately provide assistance if progress stalls."
  [Guidance, Apple HIG, Machine learning]
  <https://developer.apple.com/design/human-interface-guidelines/machine-learning>
- A short task list, shown at the start of each returning visit, with few statuses. [Guidance, GOV.UK Complete
  multiple tasks] <https://design-system.service.gov.uk/patterns/complete-multiple-tasks/>

**One clear permission to send, not routine confirmations.**

- "Generally, ask for confirmation before performing a significant action on someone's behalf." [Guidance, Apple
  HIG, Generative AI] <https://developer.apple.com/design/human-interface-guidelines/generative-ai>
- Confirmations need specific text and buttons named for the outcome, and routine ones teach people to stop
  reading. [NN/g] <https://www.nngroup.com/articles/confirmation-dialog/>
- Provide global controls. [Guidance, HAX G17]
  <https://www.microsoft.com/en-us/haxtoolkit/guideline/provide-global-controls/>

**Explain each automated decision, and make correcting it one click.**

- Automated filtering "can be the source of costly information hiding". [Guidance, Amershi et al., CHI 2019]
  <https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/>
- Make clear why the system did what it did. [Guidance, HAX G11]
  <https://www.microsoft.com/en-us/haxtoolkit/guideline/make-clear-why-the-system-did-what-it-did/>
- Support efficient correction: switch decisions, undo, batch-edit. [Guidance, HAX G9]
  <https://www.microsoft.com/en-us/haxtoolkit/guideline/support-efficient-correction/>
- People drop automation that's harder to correct than doing the task themselves; a correction should have
  immediate value. [Guidance, Apple HIG, Machine learning]
- Show the consequences of an action before and after it. [Guidance, HAX G16]
  <https://www.microsoft.com/en-us/haxtoolkit/guideline/convey-the-consequences-of-user-actions/>

**One main action per screen, with the most urgent first.**

- Avoid several default buttons on one page. [Guidance, GOV.UK Button]
  <https://design-system.service.gov.uk/components/button/>
- Critical controls such as send buttons should be visible without scrolling, with "five or less main choices on
  each screen". [Guidance, W3C COGA 4.3.4, 4.6.3] <https://www.w3.org/TR/coga-usable/>
- Status indicators by severity; more than five or six of them overwhelm. [Guidance, Carbon]
  <https://www.carbondesignsystem.com/building-blocks/core/patterns/status-indicators>
- Use banners sparingly, since people often miss them. [Guidance, GOV.UK Notification banner]
  <https://design-system.service.gov.uk/components/notification-banner/>
- Say what's happening now and next, and keep a history. [NN/g]
  <https://www.nngroup.com/articles/designing-for-waits-and-interruptions/>

**Plain words, one name per thing.**

- "Do not invent new words or give words new meanings." [Guidance, COGA 4.4.1]
- "Use the same terms consistently." [Guidance, Federal Plain Language Guidelines, GSA archive]
  <https://github.com/GSA/plainlanguage.gov/blob/main/_pages/guidelines/words/use-the-same-terms-consistently.md>
- Buttons describe the action they perform. [Guidance, GOV.UK Button]
- Error messages say what happened and how to fix it. [Guidance, GOV.UK Error message]
  <https://design-system.service.gov.uk/components/error-message/>
- About a 7th-8th grade reading level. [NN/g] <https://www.nngroup.com/articles/error-messages-scoring-rubric/>

**Settings: ask less, default more, save as you go.**

- Know why you're asking every question; start with one thing per page. [Guidance, GOV.UK Service Manual]
  <https://www.gov.uk/service-manual/design/form-structure>
- Pre-fill and infer rather than ask, and don't ask twice. [NN/g]
  <https://www.nngroup.com/articles/eas-framework-simplify-forms/>; [Guidance, WCAG 2.2 SC 3.3.7]
  <https://www.w3.org/TR/WCAG22/#redundant-entry>
- Toggles take effect at once, with no Save. [NN/g] <https://www.nngroup.com/articles/toggle-switch-guidelines/>
- Let people hide what they don't need. [Guidance, COGA 4.9.3]

**Lists and panels.**

- Rows, not cards, for lists people compare. [NN/g] <https://www.nngroup.com/articles/cards-component/>
- Show list and detail side by side only on wide windows; on narrow ones, one pane at a time. [Guidance, Material
  3, List-detail] <https://m3.material.io/foundations/layout/canonical-examples>
- A side panel is for supporting content. A consequential review gets its own page, with "Change" links, and makes
  clear nothing is final until it's confirmed. [Guidance, Material 3 Side sheets; GOV.UK Check answers]
  <https://m3.material.io/components/side-sheets/guidelines> · <https://design-system.service.gov.uk/patterns/check-answers/>
- Nothing critical behind a tab that isn't the default. [NN/g] <https://www.nngroup.com/articles/tabs-used-right/>
- Never colour alone; red only for errors. [Guidance, WCAG 2.2 SC 1.4.1; GOV.UK]

**Teach in context, not with a tour.**

- Tutorials "interrupt users, don't necessarily improve task performance, and are quickly forgotten". [NN/g]
  <https://www.nngroup.com/articles/onboarding-tutorials/>
- Empty states should explain the status and point to the next task. [NN/g]
  <https://www.nngroup.com/articles/empty-state-interface-design/>

## 4. What other job tools do [Products]

- **They say which mode is on and who presses Submit.** Simplify compares Copilot ("You click the employer's final
  Submit button") with Autopilot, which "submits without a review step".
  <https://help.simplify.jobs/articles/1784339-get-started-with-autopilot>. Jobright: "Filling a form and
  submitting an application are different actions." <https://jobright.ai/tools/ai-job-apply>
- **There's a step between practice and full automation.** AIApply has three modes: Auto, Hybrid (jobs with a fit
  score of 75% or more are sent, the rest wait for approval) and Review (approve every one).
  <https://aiapply.co/answers>. LoopCV leaves automation off until it's switched on, and setup includes a test email
  "to check out what a company will see".
  <https://loopcv.freshdesk.com/support/solutions/articles/103000275777-how-to-create-a-loop-on-our-platform>
- **They show exactly what was sent.** AIApply has a Review tab with the resume, cover letter and answers sent.
  Simplify keeps the documents it generated.
- **A failure isn't a rejection.** Simplify: "A failure is not a rejection from the employer."
  <https://help.simplify.jobs/articles/4455305-autopilot-credits-and-failed-applications>
- **Short, fixed reasons that feed back into matching.** When you reject a suggested job, AIApply asks why: Expired,
  Company, Location, Salary, Job Title, Seniority or Your Skillset. Teal asks why when you close a job.
  <https://help.tealhq.com/en/articles/9530103-closing-jobs-withdrawn-not-selected-no-response-archived>. A Jobright
  user's top complaint is jobs they rejected being shown again.
  <https://play.google.com/store/apps/details?id=ai.jobright.orion&hl=en_US>
- **Kinder, honest status words.** Indeed groups statuses by who set them and says "Response seems unlikely" after
  two quiet weeks. <https://www.indeed.com/help/job-seekers/articles/4412589551757-my-jobs-managing-applied-jobs>.
  A request on Simplify's feedback board, marked Planned, says "Rejected" is depressing and asks for "Not a Fit"
  or "No Longer in Consideration". <https://feedback.simplify.jobs/?sortBy=upvotes%3Adesc>
- **The home screen answers "what happened, and what needs me?".** Sonara: "Start each day with a list of new
  roles". LoopCV sends daily results. LinkedIn describes its tracker as removing "where do I stand?" anxiety.
- **A next step for each stage.** Teal suggests a first, second and third follow-up, then archiving after three
  weeks without a reply. <https://help.tealhq.com/en/articles/9530119-job-tracker-guidance>. Simplify suggests
  status changes from recruiters' emails, to Approve or Decline.
- **Referrals as possibilities.** Simplify: "A connection is a starting point for outreach, not a confirmed
  referral." <https://help.simplify.jobs/articles/4158996-find-referral-connections-with-simplify>
- **An activity log for unemployment claims.** Huntr's extension advertises one for "your weekly unemployment
  claims". <https://chromewebstore.google.com/detail/huntr-job-search-tracker/mihdfbecejheednfigjpdacgeilhlmnf>

What to avoid:

- **Leading with volume.** LazyApply sells up to 1,500 applications a day and has 3.4 stars on the Chrome Web Store.
- **Mixed messages about who sends.** Sonara's home and how-it-works pages disagree.
- **Showing rejected jobs again.**
- **Rigid pickers.** "Remote" becomes Remote, Oregon in Huntr; there's no Houston in Simplify's list.
- **Streaks.** For people under stress, a broken streak feels like a penalty.
- **History that disappears.** LinkedIn removes jobs after a year; Indeed shows six months.

---

## Recommendations for the app

Ranked by what they'd change for a first-time, non-technical user. Effort: S (hours), M (a day or two), L (more).

### A. Fix first: these explain the real user's stall, or can lose data

1. **Give practice mode an end, and make it unmistakable.** (M)
   - Count practice runs toward the daily limit, and stop at about 3 unchecked ones until the person looks.
   - Show the mode on every page: "Practice mode: nothing is sent. 3 practice applications ready [Check one]".
   - While filling a practice run, say "Practice run for {company}: stops before Submit", with no Submit or
     Confirmation steps.
   - Have one **Start sending** that offers to include the waiting practice runs.
   - Source: §1; NN/g modes; PAIR "automate in phases"; Apple's "assistance if progress stalls"; Simplify and
     Jobright saying who presses Submit.
2. **Ask about years of experience; don't cap them silently.** (S-M)
   - In the Jobs step of setup, ask "How many years have you done this kind of work?", prefilled from the resume's
     dates, and set the cap from it.
   - Show the rule where Simple mode can see it: "Jobs asking for more than 4 years are skipped [Change]".
   - Source: §1; HAX G1, G11; the CHI paper on information hiding.
3. **Show why jobs weren't applied to, in Simple mode too.** (M)
   - Rename Skipped to **Not applied** and keep it in Simple.
   - Group reasons at the top, using the groups `skipSummary` already computes, each with a link to the setting
     behind it: "41 asked for more experience than you have [Change]".
   - Add **Apply anyway** on each row, and make **See why** work.
   - Source: §1; HAX G9, G11, G16; Apple on corrections; AIApply's and Teal's fixed reasons.
4. **Protect the resume.** (S)
   - Tick "Add to my current resume" by default when there is one.
   - Confirm a replacement: "This replaces your 17 approved lines".
   - Offer the example profile only during setup, with no resume yet, and confirm it.
   - Source: §2; PAIR "make it safe to explore".
5. **Make the job panel scroll as one, with sticky tabs.** In a narrow window, open a job as a full page with Back.
   (S)
   - Source: §2; Material 3 list-detail.

### B. Big wins

6. **A short Check and send screen for practice runs.** Name the three things to check (the answers, the resume, the
   screenshots) and give two buttons: **Looks right: start sending** and **Something's wrong**. Put the other actions
   under More. **Something's wrong** opens the answer it's about, in place, and offers a new practice run after the
   fix. (M)
   - Source: §2; GOV.UK Check answers; COGA 4.6.2, 4.7.5; AIApply's Review tab.
7. **A status line instead of the switch.** (S-M)
   - Show "Practice mode: nothing is sent [Start sending]" or "Sending: up to 2 a day [Pause] [Back to practice]".
   - Unpause with **Continue**, not "Resume".
   - Keep it in the narrow layout.
   - Source: §1, §2; NN/g modes; HAX G17.
8. **To do first, in order of what blocks sending.** (M)
   - Order: Start sending or check a practice run, then answers that stop forms, then employers waiting on you, then
     optional things.
   - Cover every stopped application: "2 stopped for other reasons [Finish it with me]".
   - Shrink the progress card to one line.
   - On other pages, show one "3 things need you [To do]" banner instead of up to six.
   - Source: §2; COGA 4.3.4; Carbon severity; GOV.UK banners.
9. **Settings that keep what you type.** (M)
   - Autosave, with a "Saved" tick, or a save bar that appears on change and asks before leaving with unsaved edits.
   - Put Jobs to look for and About you first, with saved answers inside About you.
   - Add links to each section and fix "Settings > Running".
   - Source: §2; NN/g toggles; GOV.UK question protocol.
10. **Simple mode hides statistics, never destinations.** Keep Not applied, Job site accounts, Your data and the
    daily limit in Simple. (S)
    - Source: §2; COGA 4.9.3.
11. **One glossary everywhere: the UI, notifications, the Activity log and the README images.** (S-M)
    - Use: practice application, Start sending, Needs your answer, Not applied, Apply yourself.
    - Drop: dry run, go live, Board, Screened, queue (in words people read).
    - Source: §2; COGA 4.4.1; the Federal Plain Language Guidelines.

### C. Polish

12. **Colour.** Amber only for what blocks applications; Paused gray, not red; practice runs violet. Every status
    gets a word, an icon and a colour. (S) [WCAG 1.4.1; GOV.UK; Carbon]
13. **Kind, honest status words.** "Not sent: {reason}" for a stopped run, never anything that reads like an
    employer's no. "No reply yet" after three quiet weeks. "Not selected" for a rejection. (S) [Simplify; Indeed;
    Teal]
14. **Setup feedback.** Clear an error as soon as it's fixed and show it next to Continue. Read a resume when it's
    dropped. No "dry run" or "go live" on the first screen. (S) [GOV.UK error messages]
15. **Teach in context.** Replace the three-card tour with a one-line tip at first use, and make empty lists guide:
    "Nothing sent yet. You're in practice mode. [Check a practice application]". (S) [NN/g onboarding, empty states]
16. **Help answers the two real questions,** "Why isn't anything being sent?" and "Why were so many jobs skipped?",
    each with a button that goes there. (S)
17. **A one-line summary at the top of the Overview:** "Since yesterday: 2 sent, 1 needs you, 14 not a match". (S)
    [NN/g; LoopCV; Sonara]

### Worth considering later

- **A middle level of automation:** "Send strong matches on their own, ask me about the rest" (AIApply's Hybrid). It
  changes how the app behaves, not just how it looks, so it needs its own decision.
- **A dated log of applications for unemployment claims** (Huntr), for hourly job seekers who file weekly.
- **A short timeline in each job's panel** (found, checked, filled, sent, replied), like a delivery tracker. [NN/g
  status trackers] <https://www.nngroup.com/articles/status-tracker-progress-update/>

---

### Notes on the sources

- The PAIR patterns page and Material 3 pages render with JavaScript; their text was read from the sites' own content
  files. The Material 2 onboarding and empty-state pages couldn't be read and aren't cited.
- plainlanguage.gov now redirects to Digital.gov; the original Federal Plain Language Guidelines are cited from
  GSA's archive on GitHub.
- GOV.UK's current writing guidance gives no reading-age target; the grade 7-8 figure is NN/g's.
- Sonara and Glassdoor blocked plain requests and Chrome Web Store reviews need JavaScript; those pages were read in
  a browser. Sonara's shutdown in February 2024 and relaunch by BOLD come from a third-party page
  (<https://www.resumly.ai/answers/what-happened-to-sonara-ai>), not an official statement. No public Jobright help
  centre was found.
- Product pages change often; dates are the "updated" stamps where shown, around October-November 2026.
