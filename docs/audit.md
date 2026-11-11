# Audit: where the app could fail or confuse a regular person

Done 11 Nov 2026 on version 0.9.22 (commit `8835815`). Four passes: every screen walked in Simple mode as an hourly
job seeker at a small laptop window (1280 × 720, and 800 × 600), and three code reviews (the main loop and its data,
form filling and sending, the Electron shell and updater). Each finding says how it was checked:

- **Ran**: reproduced by running the app or the function.
- **Read**: the code path was traced end to end.
- **Suspected**: depends on a real site, macOS or Windows, none of which could be run here.

Part 1 is what was fixed with this audit. Part 2 is what's still open, most harmful first.

---

## 1. Fixed

### Applications

| What went wrong | Checked | The fix |
|---|---|---|
| **After the first real application through Greenhouse, every other Greenhouse job was skipped as "already applied".** Two links counted as the same posting when they matched up to the "?", and Greenhouse's form is `/embed/job_app?for=acme&token=123` for every employer. The same hid new postings on sites that keep the posting's number after the "?" (`?gh_jid=`, Indeed's `?jk=`). It only showed once someone was sending for real. | Ran | `cleanUrl` (`core/dedupe.js`) keeps what names the posting and drops only where the visitor came from (`utm_*`, `gh_src`, `lever-source`...). Test in `dedupe.test.js`. |
| **An application could be marked Applied when the site had rejected it.** Any thank-you wording on the page after Submit counted as the confirmation, including wording the form showed before ("Thank you for your interest in Acme"). "Your application is incomplete" and "is in progress" matched too. | Read, then ran | Only confirming words that are new since Submit count, and an emailed code is checked first (`waitOutcome` in `core/apply.js`). Test in `apply-flow.test.js`. |
| **No internet, the AI out of credit, or no browser emptied Up next into Needs you**, each job marked "Not sent: error…" and needing its own Try again. | Read, then ran | Trouble that isn't about one job (`trouble()` in `core/worker.js`) leaves the job up next with no try used. The loop waits a few minutes and tries again; the To do list, the status chip and the tray say what's wrong, with a notification when it needs the person. Loop test in `apply-flow.test.js`. |
| **A truth rule turned a right answer around.** For someone authorized to work in the United States, "Are you legally authorized to work in Canada?" answered No was "corrected" to Yes, and sponsorship the same way. | Ran | A question about another country than the one the person answered for waits for them (`otherCountry` in `core/truth.js`). A relocation question that also asks where they live is left as answered. Tests in `truth.test.js`. |
| **"Back to practice" still sent** the applications already lined up to be sent, after saying "nothing is sent". | Ran | Going back to practice turns them back into practice ones (`/api/settings`). Test in `api-new.test.js`. |
| **"It may have gone through" when Submit was never pressed**: the application counted as possibly sent from the start of the 40 to 70 second wait before Submit, so quitting during the wait raised the alarm. | Read | It counts from the press itself (`core/apply.js`). |
| **Jobs stopped at an emailed code were filled in and submitted again at every start of the app**, a new code emailed each time, each counting toward the daily limit. | Read | They get another go once, when the mailbox is connected (`retryCodeJobs`). |
| **One entry in "words that rule a title out" such as `C++` or `(contract)` stopped every search for good**, with nothing on screen. | Ran | The person's words are matched as words (`titleExcludes` in `core/discover.js`). Test in `geo.test.js`. |
| **"Fill out my page" lost a whole submission** with "e is not defined" when an AI-tool answer went to a job that already showed its full set of lines. | Ran (by the reviewer) | `core/fill.js:238`. |
| **A daily limit of 0** (the − button went that far) meant nothing ever went out, shown as "Done for today" every day. Tries per job could be 0 too. | Read | Both are at least 1. Test in `api-new.test.js`. |

### The screens

| What went wrong | Checked | The fix |
|---|---|---|
| **Help answers closed on their own** within 10 seconds of being opened, the "Include my personal details" tick was cleared and the "Saved" message went away: the page was drawn again with every look at the status. | Ran | Help is drawn once. |
| **A button could ignore a click**, and the keyboard lost its place every 10 seconds (every 2.5 while the app was busy) on the Overview and the lists, for the same reason. | Ran | A part of the page is drawn again only when it changed, never while a button is held down, and the keyboard's place is kept (`setHtml`, `focusMark` in `ui/index.html`). |
| **Messages vanished in 2.2 seconds**, too fast for a sentence such as "A button that sends it was pressed, so it may have gone through: check your email before trying again." | Ran | A message stays 2.5 to 12 seconds, by its length. |
| **Tips on the Resume page's checklist were drawn wrong** ("There's room for more": a wide blue box with the text pushed to the right). The checklist's "tip" and the Overview's tip shared a class name. | Ran | The Overview's is `.todo-tip`. |
| **Reasons a person can't act on**: "page.goto: Timeout 45000ms exceeded. Call log…", "no submit button found", "Add your API key in the add-on's Options first"; a slow job site blamed on "the AI service"; "Apply yourself: Apply yourself: …"; reasons starting in lower case. | Ran | `plainRunError` (worker) and `humanReason` (window) say what happened and what to press. Old rows are reworded on screen too. |
| **"The app tries this again next" while the app was paused**, when nothing happens until Continue. | Read | Those messages say so. Search now says so too. |
| **An Apply-yourself job said "Make my resume for this job"** in a sentence, with the button hidden under More. | Ran | The button is in that sentence's place. |
| The tray menu said **Resume** for Continue; messages named "Profile" and "Job preferences", which the app calls Resume and Jobs to look for; **Search now** said "roles". | Read | Reworded. |

### Starting, files and updates

| What went wrong | Checked | The fix |
|---|---|---|
| **A list of jobs that couldn't be read left the app running with no window**; opening it again showed Electron's "A JavaScript error occurred in the main process". | Ran | The damaged list is set aside, a new one started and the jobs applied to brought back from the application history, with a message (`main/main.js`). Any other failure to start says why in plain words and quits. Opening the app a second time while it starts no longer crashes it. |
| **A settings, answers or resume file damaged by a power cut was read as a new install**: the setup again, answers blank, and the next save made it permanent. | Ran | Those four files are written all the way to the disk, and the copy from the save before is used when one can't be read (`core/store.js`). Test in `store.test.js`. |
| **A full disk stopped the autopilot for good**, frozen on its last status: the loop's own error handler wrote to the activity log, which failed too. | Ran (the log), read | The log never throws; the loop goes on and says the disk is full. |
| **A full disk during an update download crashed the app.** After an install that failed, the autopilot stayed stopped. "fetch failed" and "terminated" were shown as they came. | Ran (the crash, by the reviewer), read | `core/update.js`, `main/updater.js`. |
| **Mailbox, GitHub and company-page errors were worded as AI errors** ("The AI key didn't work" for a mistyped mail server). | Read | `badAt` in `core/api.js`. |
| **macOS: "start with my computer" opened the window at every login.** Electron 45 no longer has `wasOpenedAsHidden`. | Read (Electron's typings) | `wasOpenedAtLogin`. Not run on a Mac. |
| **Windows notifications** may never show without the app's ID being set. | Suspected (Electron's documentation) | `app.setAppUserModelId`. Not run on Windows. |
| Cancelling "Move to Applications" left the app quitting on the next window close. | Read | `main/main.js`. |

---

## 2. Still open

Not changed, because each needs a decision, a real site, or a Mac or Windows computer to check.

### Could send or record something wrong

1. **A last step named "Continue" or "Next" isn't treated as sending.** The app presses it as a page turn; if the
   page after it has no fields and no Submit, the job is "Not sent: no submit button found" although it went out, and
   Try again applies twice. In Finish it with me the app presses that button itself. (`core/apply.js:844, 1287, 1328`.
   Read; no real site checked.) Fix: after any Next, look for a new confirmation before saying "no submit button".
2. **A CAPTCHA after Submit is marked "may have gone through"**, so Finish it with me is refused for it, the way the
   README offers. Whether the CAPTCHA frame is on the page before any challenge decides the fix, and needs a real
   site. (`core/worker.js:289`, `core/apply.js:1373`. Read.)
3. **A blocked page is filed as a closed posting.** Any answer of 400 or more is "probably closed", so a bot wall
   (403) or an outage (5xx) puts the job under Not applied. (`core/apply.js:1118`. Read.) Fix: only 404 and 410.
4. **A required password box on a long form is asked as a question**, and the answer is kept in `answers.json` in
   plain text. (`core/apply.js:48`, `core/asked.js`. Read; depends on the site.)
5. **Finish it with me** closes the tab at 30 minutes even while the person is typing; if they use the form's tab to
   open something else, the app reads and fills that page; a crash while filling puts the job back up next, where it
   can be sent without them. (`core/apply.js:986-1040`, `core/worker.js:359, 422`. Read and suspected.)

### Quietly does less than it says

6. **With a mailbox connected, a second role at the same employer is skipped as "already applied".** The app's own
   confirmation email for the first role counts as one that "names no role". This turns "2 a month" into 1.
   (`core/mail.js:107`. Ran.)
7. **The same title at the same employer is found once, ever**, whatever happened to the first (skipped, closed
   months ago, another store). The README says the app keeps two. (`core/discover.js:183, 251`. Read.)
8. **A mailbox that stops working is never reported**: "checked 10 minutes ago" goes on showing, and replies older
   than two days before the last failed check are never read. (`core/worker.js:203`. Read.)
9. **When the AI is failing, a search can hold up applications for a long time** (three tries with waits for every
   new posting), and one failed posting in a hundred raises "The AI stopped working". (`core/discover.js:288-299`.
   Read.)
10. **A job interrupted twice by quitting stays in Up next and is never picked.** (`core/worker.js:76, 422`. Ran.)
11. **"I applied" on an Apply-yourself job counts toward the app's daily limit.** (`core/api.js`, `core/db.js:80`.
    Ran.)
12. **"Unfortunately" alone marks a reply as Not selected** ("unfortunately I missed your call… are you free
    Thursday?"). (`core/mail.js:291`. Ran.)

### Installing and updating

13. **The Windows installer offers "Anyone who uses this computer"**, which installs to Program Files; every later
    update then needs an administrator prompt, and if it's declined the app has already closed. The README says the
    installer is per-user. (`electron-builder.yml`. Read in electron-builder's templates.) Fix: `build/installer.nsh`
    with `customInstallMode` forcing the current user.
14. **An update that can't replace the app says nothing**: the old version opens again and offers the same update.
    (`main/updater.js`. Read; the macOS App Management case is suspected.)
15. **Nothing checks that the tag matches `package.json`**, and the release exists for a few minutes before its files
    do, when Update now says "This release has no update file". (`release.yml`. Read.)
16. **macOS keychain: Deny** drops every secret without a word, and a key saved afterwards may be kept unencrypted.
    (`main/secrets.js`. Suspected.)

### Privacy and files

17. **The diagnostics report keeps some answers the README says are left out**: the yes/no legal answers, the
    person's cities, a phone number written another way than they typed it, a two-letter name. (`core/diagnostics.js`.
    Ran.)
18. **File errors as they come**: a password-protected PDF ("No password given"), a `.doc` renamed `.docx`, a cut-off
    history file, a list saved over a file that's open in Excel ("EBUSY"). (Ran by the reviewer.)
19. **Nothing is ever deleted**: activity, screenshots and two PDFs per job grow without limit. (Read.)

### Easier to use

20. **Closing the window for the first time** is explained only by a notification, which may not show. A one-time
    question in the window (Keep working / Quit) would be surer.
21. **The bottom of the sidebar doesn't fit a 720-pixel-tall window**: the version and Check for updates need
    scrolling, and at 640 so does the daily limit.
22. **Pay is written three ways** ("$17-$21/hour", "$18-20/hour", "$120,000-140,000"). One way everywhere: "$17 to
    $21 an hour".
23. **An Apply-yourself job opens on an empty Answers tab.** Posting or Fit would say more.
24. The 60-second video at the top of the README shows the screens from before 0.9.22.

---

## Looked at and found solid

Practice mode never reaching Submit; hidden trap fields; legal agreements; an interrupted Submit never pressed again;
the daily limit and its 9 AM reset; the 3-day spacing and monthly limit per company; pause and practice re-checked
right before Submit; sleep and wake; database upgrades; the history file; what the window may call and open; secrets
staying out of the window, the logs and the report; LinkedIn's Connections.csv; notifications not repeating.
