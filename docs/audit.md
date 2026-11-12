# Audit: where the app could fail or confuse a regular person

Done 11 Nov 2026 on version 0.9.22 (commit `8835815`). Four passes: every screen walked in Simple mode as an hourly
job seeker at a small laptop window (1280 × 720, and 800 × 600), and three code reviews (the main loop and its data,
form filling and sending, the Electron shell and updater). Each finding says how it was checked:

- **Ran**: reproduced by running the app or the function.
- **Read**: the code path was traced end to end.
- **Suspected**: depends on a real site, macOS or Windows, none of which could be run here.

Part 1 is what was fixed first. Part 2 is the rest, fixed in a second round. Part 3 is what still needs checking on a
Mac, on Windows or on a real job site.

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

## 2. Fixed in a second round

Everything the first round left open. Numbers are the ones those items had in the first version of this file.

### Could send or record something wrong

| # | What went wrong | Checked | The fix |
|---|---|---|---|
| 1 | **A last step named "Continue" or "Next" wasn't treated as sending**: "Not sent: no submit button found" for an application that went out, and Try again applied twice. | Ran | After a Next with nothing left to fill in or press, a new confirmation means applied, and none means it may have gone through (`lastNext` in `core/apply.js`). Test in `apply-flow.test.js`. |
| 1 | In Finish it with me the app pressed Next itself, and so could send. | Ran | The person presses every button that moves the form on. |
| - | **Found by the new test:** on a form that swaps its pages in place, the app pressed the first page's hidden Next again on page 2 and timed out. | Ran | The mark comes off the old button first (`NEXT_JS`, `SUBMIT_JS`). |
| 2 | **A CAPTCHA after Submit was marked "may have gone through"**, so Finish it with me was refused for it. The check also took the challenge's frame being on the page for a challenge, and that frame is there from the start. | Ran | Only a challenge that is showing counts; then nothing was sent, and it can be finished with the app. The same for an emailed code that never came (`notSent`). |
| 3 | **A blocked page (403) or an outage (5xx) was filed as a closed posting.** | Ran | Only 404 and 410 mean closed. A site that refuses the app's browser goes to Apply yourself; one that is down is tried again. |
| 4 | **A form that makes an account as it goes** (a required password among its questions) had the password asked as a question and kept in plain text. | Ran | It's a sign-in wall: Apply yourself. A password, Social Security number, bank or card number is never asked for or kept (`SECRET_RX` in `core/asked.js`). |
| 5 | **Finish it with me** closed the tab at 30 minutes even while the person typed; read and filled whatever page they opened in the form's tab; and a crash while filling put the job back up next. | Read; the crash ran | The wait runs from the last thing typed (two hours at most). On a page that isn't the application the app does nothing. A job being finished goes back where it was after a crash. |

### Quietly did less than it said

| # | What went wrong | Checked | The fix |
|---|---|---|---|
| 6 | With a mailbox connected, a second role at one employer was skipped as "already applied". | Ran | The app's own confirmations for other roles there don't count (`matchConfirmation`). |
| 7 | The same title at one employer was found once, ever. | Ran | A job that was left out stands for new postings of it for a month. One the app has still stands for them all (the app never applies to the same role twice). |
| 8 | A mailbox that stopped working was never reported. | Ran | "Checked" is the last real read; a failure is in the To do list, with a notification; nothing is skipped once it works again. |
| 9 | A failing AI held searches up, and one failed posting raised "The AI stopped working". | Ran | After five postings in a row with no answer the rest wait; the warning needs every one to have failed. |
| 10 | A job interrupted twice by quitting stayed in Up next and was never picked. | Ran | With no try left it goes to Needs you, with Try again. |
| 11 | "I applied" counted toward the app's daily limit. | Ran | It doesn't. |
| 12 | "Unfortunately" alone marked a reply as Not selected. | Ran | It counts with the no that follows it. |

### Installing, updating, files

| # | What went wrong | Checked | The fix |
|---|---|---|---|
| 13 | The Windows installer offered "Anyone who uses this computer". | Read (electron-builder's templates) | `build/installer.nsh` installs for the person who runs it. **Not built here**: the next Windows build will show whether it compiles. |
| 14 | An update that couldn't replace the app said nothing. | Read | The app notes what it was updating to before it closes; back as the old version, it says so, with **Download it**. |
| 15 | Nothing checked the tag against `package.json`; the release existed before its files. | Read | **Still open.** The change to `release.yml` is written (a check, and a draft until the files are on it) but not in the repository yet: pushing a workflow file needs a GitHub login that is allowed to change workflows. |
| 16 | macOS keychain: Deny could leave a key saved unprotected. | Read | Never written unprotected on a Mac or Windows; saving fails and says why. **Not run on a Mac.** |
| 17 | The diagnostics report kept some answers. | Ran | Legal and personal yes/no answers are only "set"; quoted answers in the app's notes go; the phone number however it's written; the home folder's name. The city searched around stays, and the README says so. |
| 18 | File errors as they came. | Ran (the reviewer), read | A locked PDF, a `.doc` renamed `.docx`, a cut-off history file, a file open in another program: each says what to do. |
| 19 | Nothing was ever deleted. | Ran | `core/tidy.js`, at each start. Sent applications keep everything. Test in `tidy.test.js`. |
| - | Quit from the tray or Cmd+Q skipped closing the browser the app applies with. | Read | `will-quit` in `main/main.js`. |

### Easier to use

| # | What | The change |
|---|---|---|
| 20 | Closing the window for the first time was explained only by a notification. | The window asks once: **Keep it working** or **Quit Job Autopilot**. |
| 21 | The bottom of the sidebar didn't fit a short window. | It fits at 960 × 640 in Simple (measured). |
| 22 | Pay was written three ways. | One way: "$17 to $21 an hour". |
| 23 | A job with no answers yet opened on an empty Answers tab. | It opens on what the posting asks for, or the posting. |
| - | Setup, the AI step: one long sentence. | Three numbered steps above the button. |
| - | Setup, the resume step: a **Read my resume** button that did nothing after a file was dropped, and GitHub projects offered to everyone. | The button shows only when something waits to be read; GitHub only for office and tech work. |
| - | **It's all true** used the system's OK/Cancel box. | Asked in the page: **Yes, all of it** / **Not yet**. |
| 24 | The README's video showed old screens. | `node scripts/tour-video.mjs` makes it again (`out/tour.mp4`). GitHub only plays a video dropped into one of its own text boxes, so the new link has to be made by hand. |

## 3. What still needs a look that couldn't be had here

- **A Mac:** started at login stays hidden; the keychain's Deny; the first-close question; Quit closing the browser.
- **Windows:** the installer without the "Anyone who uses this computer" page; notifications showing; an update that
  Windows won't let through.
- **Real job sites:** a last step named "Continue"; a CAPTCHA after Submit; a 403 bot wall. Each is covered by a
  test page here, not by a live site.
- **A Mac with Chrome as the person's own browser:** when a new application tab opens, focus may go to the wrong
  app (`core/browser.js`, `keepFocus`). Suspected by the reviewer; nothing was changed.

---

## Looked at and found solid

Practice mode never reaching Submit; hidden trap fields; legal agreements; an interrupted Submit never pressed again;
the daily limit and its 9 AM reset; the 3-day spacing and monthly limit per company; pause and practice re-checked
right before Submit; sleep and wake; database upgrades; the history file; what the window may call and open; secrets
staying out of the window, the logs and the report; LinkedIn's Connections.csv; notifications not repeating.
