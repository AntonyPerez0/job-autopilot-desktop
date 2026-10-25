# Job Autopilot

A desktop app for macOS and Windows that finds jobs that match what you're
looking for and applies to them. For each job it builds a one-page resume from
pieces of your own resume that you approved, fills in the application in a
browser window you can watch, checks every answer, and submits it. It keeps a
full record of every application.

It starts in **dry run**: forms get filled in but nothing is sent until you have
checked one and switched it to live.

## Download and install

Download the latest version from
[Releases](https://github.com/AntonyPerez0/job-autopilot-desktop/releases/latest):

- **Mac** (Apple Silicon or Intel): `Job-Autopilot-<version>-mac-universal.dmg`
- **Windows** 10 or 11: `Job-Autopilot-Setup-<version>.exe`

These builds are not signed with an Apple or Microsoft certificate yet, so your
computer will warn you the first time you open the app. Here's how to get past
the warning once.

### Mac

1. Open the `.dmg` and drag **Job Autopilot** into **Applications**.
2. Double-click Job Autopilot in Applications. macOS says it "cannot verify"
   the app. Click **Done** (or **Cancel**).
3. Open **System Settings > Privacy & Security**, scroll down to the message
   about Job Autopilot, and click **Open Anyway**. Enter your password if asked.
4. Click **Open** in the dialog that follows. From then on it opens normally.

On older macOS versions you can instead right-click (or Control-click) the app
in Applications, choose **Open**, then **Open** again.

The first time you save your API key, macOS may ask to let Job Autopilot use
your keychain. Click **Always Allow**: that's where the key is kept, encrypted.

### Windows

1. Run `Job-Autopilot-Setup-<version>.exe`.
2. If Windows shows **"Windows protected your PC"**, click **More info**, then
   **Run anyway**.
3. Follow the installer. It installs just for you and doesn't need admin
   rights. You'll find Job Autopilot in the Start menu and on your desktop.

### Updates

The app tells you on the Overview page when a newer version is out. Download it
from Releases and install it over the old one. Your data stays where it is.

## First run: the setup

The app walks you through six steps. You can change all of it later under
**Settings** and **Profile**.

1. **AI key.** The app uses an AI model you pay for with your own key.
   [OpenRouter](https://openrouter.ai/settings/keys) is the default: create a
   key, add a few dollars of credit, paste the key in, and press **Test key**.
   Any OpenAI-compatible service works too; choose "Another OpenAI-compatible
   API" and enter its address. The default model is `z-ai/glm-5.3-flash`;
   **Show available models** lists the others.
2. **Your resume.** Drop in one or more resumes (PDF or Word `.docx`). The app
   reads them and splits them into summaries, bullet points, skill groups,
   education and a base layout.
3. **Review.** Every piece starts unapproved. Edit anything that isn't exactly
   true, delete what you'd never send, and tick the rest. Resumes are only
   ever put together from approved pieces: the AI picks which pieces fit each
   job, and never writes resume text itself. Use the eye button on a layout to
   preview the PDF.
4. **Common questions.** Your name, contact details and links, address
   (street is optional), work authorization and sponsorship, education with
   dates, years of experience by kind of work, notice period and start date,
   relocation and travel, how arbitration agreements are handled, voluntary
   self-identification (declined by default), and a list of things you can
   never claim.
5. **Job preferences.** Job titles to search for, what you want the work to
   involve, cities plus a radius and/or remote jobs in your country, the levels
   you'd accept, the most years of experience a job may require, companies to
   skip, and how recent the postings should be.
6. **Mailbox (optional).** See [Mailbox](#mailbox).

Then press **Start in dry run**.

## What happens next

- It searches [freehire.me](https://freehire.me) every two hours for your
  titles and places. It only keeps jobs that use Greenhouse, Lever or Ashby,
  because those don't make you create an account to apply. It skips recruiting
  agencies, companies you excluded, and anything you already applied to. Then
  the AI reads each posting against your facts and only queues the ones you
  actually qualify for.
- For each queued job, a browser window opens and the app:
  - reads the form
  - builds your resume for that job
  - fills in every answer
  - checks every answer
  - takes screenshots
- **In dry run** it stops before Submit. The first filled application shows
  up on the Overview. Open it to see every answer (and where each one came
  from), the resume PDF, the screenshots and the posting. If it's right, press
  **I checked these answers**. If something's wrong, fix your answers in
  Settings.
- **Go live** (the switch in the sidebar) unlocks once you've checked a filled
  application. From then on it submits: 10 a day by default, 6 minutes apart,
  and the daily count resets at 9 AM your time. You can pause it or switch
  back to dry run any time.
- The app only works while it's open. Closing the window stops it. Each
  application takes a few minutes.

The browser is your installed Google Chrome, or Microsoft Edge if you don't
have Chrome. With neither, the app downloads its own Chromium (about 150 MB,
once). The app uses its own browser profile, separate from your everyday one,
so it never sees your bookmarks, passwords or other logins. To keep the window
out of sight, turn on **Hide the browser window** in Settings.

## What it won't do

- **Submit an incomplete application.** If a required question has no
  answer, or no answer it can back up with your facts, the job goes to
  **Needs attention** with the reason. Nothing goes out.
- **Make things up.**
  - Every fact comes from your approved resume pieces and your answers.
  - Truth rules check the questions that matter most against what you
    entered, and correct any AI answer that disagrees:
    - work authorization and sponsorship
    - years of experience
    - how you heard about the job
    - start date and notice period
    - graduation date
    - relocation
    - self-identification
  - A second AI pass fact-checks every written answer. Answers it can't
    confirm aren't used.
  - Anything that mentions something on your "can never claim" list is thrown
    out.
- **Agree to legal terms for you.** Arbitration agreements, jury and
  class-action waivers, non-competes, releases of claims, and background-check
  or drug-test consents always wait for you. The one exception: you can let it
  accept plain arbitration agreements in Settings.
- **Apply twice.**
  - The same posting is never applied to again.
  - The same role on another job board, or under a slightly different title,
    counts as the same job.
  - It also skips anything on your "already applied" list.
  - With a mailbox connected, it skips anything an employer has already sent
    you a "thank you for applying" email about.
  - If the app is closed in the middle of pressing Submit, that job is never
    pressed again automatically. It waits for you.
- **Solve CAPTCHAs, create accounts or log in anywhere.** Jobs that need any of
  that are skipped or left for you.

### Mailbox

Greenhouse sometimes emails a security code that has to be typed into the
form before it accepts an application. With your mailbox connected, the app
reads the code and finishes the application. Without it, those jobs wait in
Needs attention. The app also uses the mailbox to spot employers' "thank you
for applying" emails.

The connection is read-only: the app never sends, deletes, moves or marks
anything. It needs an **app password**, which is a separate password just for
this app. You can only create one when two-step verification is turned on.

- **Gmail:** turn on 2-Step Verification, then create an app password at
  [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
- **Yahoo:** go to
  [login.yahoo.com/account/security](https://login.yahoo.com/account/security)
  and choose **Generate app password**.
- **iCloud:** go to [account.apple.com](https://account.apple.com), then
  **Sign-In and Security > App-Specific Passwords**.
- **Outlook.com / Hotmail:** not supported directly. Microsoft stopped
  allowing app passwords for mail apps in September 2024. Instead, forward
  your Outlook mail to a Gmail, Yahoo or iCloud mailbox and connect that one,
  or skip this step.

Use the mailbox that receives mail for the email address you put on your
applications.

## Privacy

Everything stays on your computer, in one folder (Settings > Your data > Open
the folder):

- macOS: `~/Library/Application Support/Job Autopilot`
- Windows: `%APPDATA%\Job Autopilot`

That folder holds your profile, answers, preferences, the job list, every
resume that was sent, and the screenshots. The API key and mailbox password
are encrypted by your operating system's keychain (macOS Keychain, Windows
DPAPI).

The app only sends data to:

- **Your AI provider** (OpenRouter by default): your approved resume pieces
  and answers, plus each posting and its form questions. This is how it
  screens jobs, plans each application and fact-checks answers.
- **freehire.me**: the job titles, places and filters you search for. No
  personal details go to freehire.
- **The job sites themselves** (Greenhouse, Lever, Ashby and the employers):
  the application you send.
- **Your mailbox** (if connected): read-only access over IMAP.
- **GitHub**: a check for new versions. Chromium is downloaded from
  Playwright's servers, and only if you have neither Chrome nor Edge.

There are no analytics and no accounts, and nothing goes to the author of this
app.

## What it costs

The app is free. You pay your AI provider for what it uses, on your own key.
Each posting it screens is one short AI call. Each application is two or three
longer ones (the plan, then the fact-check), roughly 10,000 to 20,000 tokens
in all. With a small, cheap model like the default `z-ai/glm-5.3-flash`, that
usually comes to a cent or less per application. Bigger models cost more. The
model's price is shown on OpenRouter, and your actual usage is on your
provider's dashboard. Setting a spending limit on the key is a good idea.

## Things to know

- **Job sites' terms.** Some job sites and employers don't allow automated
  applications, and some employers may treat them differently. You're
  responsible for every application sent in your name. That's why the app
  starts in dry run, keeps a steady pace and records everything.
- **Sites change.** Greenhouse, Lever and Ashby change their forms from time to
  time. When a form can't be filled correctly, the app stops and puts the job
  in Needs attention instead of sending something half-done.
- **The AI can still be wrong.** The truth rules only cover the common
  questions listed above. Other answers depend on the fact-check and on your
  review. Look through the Answers tab of a few applications now and then.

## Troubleshooting

- **"The key did not work."** Check you copied the whole key and that your
  OpenRouter account has credit. For other providers, check the API address
  ends in `/v1`.
- **Nothing gets queued.** Look at **Skipped** to see why jobs were left out.
  Add more job titles, widen the radius, allow more levels, or raise the
  maximum years required.
- **Lots of jobs in Needs attention with "Missing info."** Open one. The
  reason names the question. Usually it's a fact the app doesn't have yet, like
  years of a particular skill or a street address. Add it under Settings >
  Common questions, then press **Try again** on the job.
- **"Email code needed."** Connect your mailbox in Settings. Those jobs retry
  on their own.
- **"The application browser is already open."** Close the extra browser
  window the app opened, or restart the app.
- **The browser doesn't start.** In Settings > Pace and browser, press **Check
  browsers**. If Chrome and Edge aren't found, press **Download Chromium now**
  (you need a connection that allows downloads from `cdn.playwright.dev`).
- **macOS says the app is damaged.** Make sure you dragged it into
  Applications first. If it still says so, open Terminal and run
  `xattr -cr "/Applications/Job Autopilot.app"`, then open it again.
- **Start over.** Settings > Your data > **Run the setup again**. To wipe
  everything, quit the app and delete the data folder listed above.

## For developers

```sh
npm ci
npx playwright-core install chromium   # for the form-filling tests
npm test                               # unit tests and form-fill tests in Chromium
npm run e2e                            # walks the first-run setup in the real app (mock AI)
npm start                              # runs the app from source
JA_API_KEY=... node scripts/live-dry-run.mjs   # one dry run against a live posting, example profile
```

How the code is laid out:

- `core/`: the engine.
  - discovery (`discover.js`, `geo.js`)
  - applying (`apply.js`, `browser.js`)
  - the user's facts, truth rules and fact-check (`facts.js`, `truth.js`,
    `engine.js`)
  - mail (`mail.js`)
  - never-twice checks (`dedupe.js`)
  - the loop (`worker.js`)
  - the window's API (`api.js`)
- `main/`: the Electron shell.
- `ui/`: the setup wizard and the dashboard.
- `vendor/apply-helper/`: the Apply Helper add-on's tailoring, PDF and
  form-filling scripts, used unchanged (see `VENDORED.md`).

Installers are built by GitHub Actions (`.github/workflows/release.yml`) on
macOS and Windows runners. The workflow installs each one, launches it and
runs the setup end to end. Pushing a `v*` tag attaches the installers to a
GitHub Release. Signing is described in [docs/SIGNING.md](docs/SIGNING.md).

Place data © [GeoNames](https://www.geonames.org), CC BY 4.0. pdf-lib, unpdf,
mammoth, imapflow, mailparser and playwright-core are used under their own
licenses.

## License

[MIT](LICENSE)
