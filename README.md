<div align="center">
  <img src="public/favicon-96x96.png" width="72" height="72" alt="">
  <h1>fuh-moodle</h1>
  <p><em>Automate the boring, repetitive quizzes with AI. Sit back, relax.</em></p>
</div>

---

A dashboard that signs into a **Moodle** instance as a student, lists your enrolled
courses, shows the attempt status of every quiz, and — on demand — solves
multiple-choice quizzes by scraping the questions, sending them to the **Groq**
chat-completions API, and submitting the answers back to Moodle page by page.

This is a TypeScript/Next.js port of an earlier Python/FastAPI app. See
[`MIGRATION.md`](./MIGRATION.md) for the full technical specification of the
original and the reasoning behind the port.

## How it works

There is **no Moodle Web Services token involved.** The app drives the ordinary
HTML login form and reuses the resulting session cookie against a mix of Moodle's
internal AJAX endpoint and plain HTML pages that it parses with regexes. In other
words: HTTP + cookies + scraping, not a typed SDK.

```
browser                    Next.js route handler              Moodle / Groq
───────                    ─────────────────────              ─────────────
credentials in         ──▶ login handshake (3 hops)      ──▶  /login/index.php
localStorage               scrape + parse                ──▶  /course/view.php
                           batch prompt                  ──▶  api.groq.com
                       ◀── parsed JSON only
```

### Everything Moodle-facing runs server-side

The browser cannot talk to Moodle directly, for two independent reasons:

1. **CORS.** The app works by *reading response bodies*. Moodle sends no
   `Access-Control-Allow-Origin` for your domain, so the browser would refuse to
   hand you any of them.
2. **Cookies.** `MoodleSession` is not set with `SameSite=None; Secure`, so
   browsers will not attach it cross-site — and third-party cookie blocking
   finishes the job.

So each route handler is a thin, stateless proxy: it receives credentials in the
POST body, performs the round trip server-side, returns parsed JSON, and forgets
everything.

### Your credentials are yours

Your Moodle URL, username, password and Groq key live in **`localStorage` in your
browser** and are sent with each request. The server keeps no database, no session
table, and no secrets — there is nothing on the deployment to leak. Practically the
same trust model as running it on localhost.

Every call is a `POST` so credentials travel in the request body. Nothing sensitive
ever reaches a URL, and therefore nothing sensitive reaches request logs.

## Setup

Requires **Bun** (or npm/pnpm — adjust commands accordingly).

```bash
bun install
cp .env.example .env.local     # then edit it
bun dev
```

Open <http://localhost:3000>.

### Environment

The dashboard sits behind a single operator login, configured entirely through the
environment. **This is separate from your Moodle credentials** — those are entered
in the app itself and never stored server-side.

| Variable | Required | Purpose |
| --- | --- | --- |
| `ADMIN_USERNAME` | yes | Username for the dashboard login |
| `ADMIN_PASSWORD` | yes | Password for the dashboard login |
| `AUTH_SECRET` | no | Signs the session cookie. Defaults to a key derived from the two above, which means changing the password invalidates existing sessions. Set it (`openssl rand -base64 32`) to decouple them. |

Without `ADMIN_USERNAME` and `ADMIN_PASSWORD` the app **fails closed** — nobody can
sign in. A missing password never means "let everyone in".

## Using it

1. Sign in at `/login` with the operator credentials.
2. Fill in the Moodle URL, username and password in the sidebar, plus a
   [Groq API key](https://console.groq.com/keys) if you want to solve anything.
3. Pick a course. Quizzes load with their attempt status, marks and grade.
4. Hit **Solve** on one quiz, or **Solve all pending** to run every unfinished quiz
   in sequence.

The solver terminal streams a live log, shows the current question with the model's
pick highlighted, and reports the final grade.

### Choosing a model

Default is `openai/gpt-oss-120b`, which supports structured outputs, so the answer
sheet comes back schema-valid on the first attempt.

The Groq call has a fallback ladder — `json_schema` → `json_object` → plain text
with tolerant JSON extraction — and only a failure advances it, so a supported model
still costs exactly one request. Reasoning models that emit `<think>` blocks and
models that wrap output in markdown fences are both handled.

Two things that will not work:

- **Classifier and guard models** (`llama-prompt-guard-*`) cannot answer questions
  at all. You will get a clear error saying so.
- **Agentic systems** (`groq/compound`) have a tighter request ceiling; a large quiz
  returns HTTP 413. The error names the prompt size and suggests alternatives.

## Architecture

```
app/
  page.tsx                              landing page
  login/                                operator login + server actions
  dashboard/                            the app (guarded by layout.tsx)
  api/
    status/                POST         verify Moodle credentials
    courses/               POST         enrolled courses
    courses/[id]/quizzes/  POST         quizzes + attempt status
    solve/start/           POST         open attempt, harvest, call Groq
    solve/submit-page/     POST         submit one page of answers
    solve/finish/          POST         finalise, scrape the grade
lib/
  moodle/
    client.ts     cookie jar + manual redirect following
    parse.ts      every regex, in one file
    auth.ts       the login handshake
    courses.ts    the AJAX call
    quizzes.ts    course-page scraping, parallel status lookups
    attempt.ts    start/resume, harvest, submit, finalise
  groq.ts         batched solve with the fallback ladder
  session.ts      signed session tokens (Web Crypto)
proxy.ts          route gate (Next 16's replacement for middleware.ts)
```

### The solve flow is client-driven

Rather than one long-lived stream, the solve is split into short calls the client
drives in sequence:

| Call | Does | Cost |
| --- | --- | --- |
| `solve/start` | resume-or-start attempt → discover pages → harvest all → one Groq call | the long step |
| `solve/submit-page` × N | fetch page, build payload, POST it | seconds each |
| `solve/finish` | `processattempt.php`, scrape grade | seconds |

The client holds `attemptId` and the answer map between calls, so a single failed
page can be retried without restarting the whole solve, and every call sits well
inside a serverless timeout.

Harvest pages are fetched **concurrently** (read-only, so order does not matter).
Submissions are **strictly sequential** — they mutate attempt state, and Moodle's
`sequencecheck` rejects out-of-order posts.

### Answers are matched by text, not by letter

The harvest pass and the submit pass are two separate fetches of the same page. If
Moodle's `shuffleanswers` is on, the options can be re-ordered between them, so
carrying the answer as a bare letter would tick the wrong row — while the log still
looked perfect. The chosen option is therefore matched on its **text**, with the
letter only as a fallback, and any disagreement is reported in the log.

## Deployment

Deploys to Vercel's Hobby tier without modification. Set `ADMIN_USERNAME`,
`ADMIN_PASSWORD` and ideally `AUTH_SECRET` in Project Settings → Environment
Variables.

Every Moodle-facing route exports `maxDuration = 300` (Hobby's ceiling, available
with Fluid compute). The Node runtime is the default in Next 16 and the Edge runtime
is deprecated, so no `runtime` export is needed.

The real metered resource is Provisioned Memory (360 GB-hrs/month), which works out
to roughly 3,000 full solves a month. You will not come close to any limit.

**One thing to test first:** functions egress from rotating datacenter IPs in
US-East, so your Moodle will see logins from Virginia rather than from you. Repeated
logins from datacenter ranges are exactly what security plugins flag. Verify a
single `/api/status` call from a deployed preview before building on it.

## Known limitations

- **Theme coupling.** Every selector assumes Boost-like markup (`instancename`,
  `qtext`, `answernumber`, `flex-fill`, `data-quiz-page`). A theme change or major
  Moodle upgrade can break scraping. All patterns live in `lib/moodle/parse.ts` so
  the blast radius is one file, and a page that yields no questions but has
  substantial content raises a distinct "parser may be out of date" error rather
  than "no MCQs found".
- **Only multiple-choice.** Questions with no parseable options — essay, numeric,
  matching — are skipped silently.
- **Omitted answers default to "a".** If the model skips a question, the log says so
  and the solver picks the first option rather than leaving a blank.
- **No session caching.** Every request re-logs in (~2 extra round trips). A
  module-level cache is nondeterministic on serverless, so it was deliberately not
  ported. Note that repeated failed logins can trip Moodle's account lockout.
- **Accuracy is the model's, not the scraper's.** The log prints the exact question
  and option text sent to Groq before the call, so a bad score can be attributed to
  the right layer.

## Scripts

```bash
bun dev          # dev server
bun run build    # production build
bun run start    # serve the build
bun run lint     # eslint
```

## A note on use

This automates submitting quiz attempts on your own account. Whether that is
acceptable is between you and your institution's academic integrity policy — the
tool has no opinion, but your university probably does.
