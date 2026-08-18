# Moodle Automation Controller — Full Technical Spec & Next.js Migration Guide

> **Purpose of this document.** It is a complete, self-contained reference for the existing
> Python/FastAPI app (`src/web.py`, `src/main.py`, `src/static/*`) and a migration plan to
> **Next.js (App Router) + shadcn/ui deployed on Vercel's free Hobby tier**.
>
> Written to be handed to a fresh Claude Code session that has a Next.js + shadcn project
> already scaffolded. Assume the reader has **not** seen the Python source. Every Moodle
> request, every response shape, and every regex is reproduced below.

---

## 1. What this project does

A dashboard that logs into a **Moodle** instance as a student, lists enrolled courses,
lists the quizzes in a course with their attempt status, and — on demand — **automatically
solves multiple-choice quizzes** by scraping the questions, sending them to the **Groq
chat-completions API**, and submitting the returned answers back to Moodle page by page.

There is **no official Moodle Web Services / REST token involved.** The app authenticates by
driving the **normal HTML login form** and then reuses the resulting session cookie to hit a
mix of Moodle's internal AJAX endpoint and plain HTML pages that it scrapes with regex.
This matters enormously for the port: it means the port is "HTTP + cookies + regex", not
"call a typed SDK".

### Current file inventory

| File | Lines | Role |
| --- | --- | --- |
| `src/web.py` | 621 | **The entire backend.** FastAPI. This is the file to port. |
| `src/main.py` | 652 | Older `rich`-based interactive CLI. Same logic, superseded. Port nothing from it except the one-question Groq prompt (§5.2) if you want a fallback. |
| `src/static/index.html` | 201 | Dashboard markup |
| `src/static/app.js` | 574 | All frontend logic (vanilla JS, no framework) |
| `src/static/style.css` | 829 | Design-token CSS |
| `DESIGN.md` | — | Design system: OKLCH palette, type scale, component rules |
| `PRODUCT.md` | — | Product brief, brand personality, anti-references |
| `Dockerfile` / `docker-compose.yml` | — | Local Moodle 4.5 + MariaDB for testing. **Not part of the deployment.** |

### Dependencies — note how few

`src/web.py` imports only `fastapi`, plus Python stdlib: `urllib.request`, `urllib.parse`,
`http.cookiejar`, `re`, `json`, `os`, `time`. **No BeautifulSoup, no lxml, no Selenium, no
Playwright, no database, no ORM, no auth library.** All HTML parsing is hand-rolled regex and
string splitting. This is why the TypeScript port is mechanical rather than a rewrite.

---

## 2. Configuration & the credential model

### 2.1 The four secrets

| Key | Example | Used for |
| --- | --- | --- |
| `MOODLE_URL` | `https://moodle.example.edu` | Base URL, always `.rstrip('/')`-ed before use |
| `MOODLE_USERNAME` | `s12345` | Moodle login form |
| `MOODLE_PASSWORD` | `••••••` | Moodle login form |
| `GROQ_API_KEY` | `gsk_...` | `Authorization: Bearer` to Groq |

`src/.env` exists for the CLI (`main.py` has a `load_env()` that searches `.env`, `../.env`,
and paths relative to `__file__`). **The web app does not read `.env`.**

### 2.2 Credentials are bring-your-own, client-held — keep it that way

The server stores **nothing**. The browser holds all four values in `localStorage` under keys:

```
moodle_url   username   password   groq_api_key
```

and re-sends them on **every single request**. There is no server-side user account, no
session table, no database. This is the correct model for the Vercel port too: it means the
deployment holds no secrets, has nothing to leak, and cannot be abused by anyone who does not
already possess a working Moodle login.

**Two transport mechanisms exist today, and one of them is a defect:**

- JSON endpoints receive credentials as **request headers**: `X-Moodle-Url`,
  `X-Moodle-Username`, `X-Moodle-Password`.
- The solver stream receives them as **URL query parameters** — `?moodle_url=…&username=…
  &password=…&groq_api_key=…` — because the browser `EventSource` API cannot set custom
  headers. **This puts the Moodle password and the Groq key into Vercel's request logs.**
  Fixing this is a primary goal of the migration (see §7.3).

---

## 3. Session establishment — the Moodle login handshake

This is the foundation everything else sits on. Three HTTP steps.

### Step 1 — GET the login page to harvest the CSRF token

```
GET {base}/login/index.php
```

Moodle returns the login form containing a hidden anti-CSRF field. Extract it:

```python
re.search(r'name="logintoken"\s+value="([^"]+)"', html)
```

If this does not match, the code raises `"Login token not found on the login page."`
The response also sets the initial `MoodleSession` cookie — **you must keep the cookie jar
from this request and reuse it for step 2**, or the token will not validate.

### Step 2 — POST the credentials

```
POST {base}/login/index.php
Content-Type: application/x-www-form-urlencoded

username={username}&password={password}&logintoken={logintoken}
```

Moodle responds with a redirect chain ending at the dashboard (`/my/`). The cookie jar picks
up the authenticated `MoodleSession` cookie along the way.

### Step 3 — Extract the `sesskey`

The `sesskey` is Moodle's per-session CSRF token, embedded in a JS config blob in the HTML of
every authenticated page. Search the landing page:

```python
re.search(r'"sesskey":"([^"]+)"', landing_html)
```

**Fallback:** if that fails on the landing page, fetch `{base}/my/` with the same cookie jar
and search again. If it still fails, raise `"Failed to locate sesskey after login. Check your
credentials."` — in practice a missing sesskey is how wrong credentials manifest, because a
failed login re-renders the login form rather than returning an HTTP error status.

**Return value:** `(sesskey, cookie_jar)`. Both are needed downstream — the cookie jar
authenticates the requests, the sesskey authorises the AJAX and submit actions.

### 3.1 Session caching (and why it must change)

`web.py` holds a module-level dict:

```python
SESSION_CACHE = {}           # key: (base_url.rstrip('/'), username)
                             # val: {'sesskey', 'cookie_jar', 'timestamp'}
```

with a **600-second (10 minute) TTL**. On a hit inside the TTL it skips the login handshake.

**On Vercel this cache is effectively useless and must not be relied upon.** Serverless
invocations do not share memory; a warm instance may occasionally reuse it, but a cold one
will not, so behaviour would be nondeterministic. See §7.4 for the replacement strategy.

### 3.2 Required request headers

Every request to Moodle sends a browser User-Agent. Moodle (and any WAF in front of it) may
behave differently for non-browser agents.

```
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36
```

Form posts additionally send `Content-Type: application/x-www-form-urlencoded`.
The AJAX call sends `Content-Type: application/json` and `Accept: application/json`.

---

## 4. Moodle data endpoints — request & response reference

### 4.1 Enrolled courses — the one real "API" call

This is the only structured endpoint in the whole app. It hits Moodle's **internal AJAX
service**, which speaks JSON.

```
POST {base}/lib/ajax/service.php?sesskey={sesskey}&info=core_course_get_enrolled_courses_by_timeline_classification
Content-Type: application/json
Accept: application/json
Cookie: MoodleSession=…
```

**Body** (note: an *array* of call objects — Moodle batches AJAX calls):

```json
[
  {
    "index": 0,
    "methodname": "core_course_get_enrolled_courses_by_timeline_classification",
    "args": {
      "offset": 0,
      "limit": 0,
      "classification": "all",
      "sort": "fullname"
    }
  }
]
```

`limit: 0` means unlimited. `classification: "all"` includes past, in-progress and future
courses.

**Response** — an array parallel to the request array:

```json
[
  {
    "error": false,
    "data": {
      "courses": [
        {
          "id": 2,
          "fullname": "Introduction to Databases",
          "shortname": "CS201",
          "viewurl": "https://moodle.example.edu/course/view.php?id=2",
          "...": "many more fields Moodle returns but this app ignores"
        }
      ],
      "nextoffset": 0
    }
  }
]
```

**Handling:**
- Take element `[0]`.
- If `item["error"]` is truthy → raise `Moodle AJAX API Error: {item["exception"]}`.
- Otherwise return `item["data"]["courses"]` (default `[]`).
- If the response is not a non-empty array → raise `"Unexpected response format from Moodle courses API."`

**The frontend consumes only `id`, `fullname`, and `shortname`.** The full course object is
passed through untouched, so the port may either pass through or narrow to those three.

### 4.2 Quizzes in a course — scraped from the course page

There is no AJAX endpoint used here. The course page HTML is fetched and regexed.

```
GET {base}/course/view.php?id={course_id}
```

**Extraction regex** (Python `re.findall` with `re.DOTALL`):

```python
r'<a[^>]*href="([^"]*mod/quiz/view\.php\?id=(\d+))"[^>]*>.*?<span class="instancename">([^<]+)'
```

Three capture groups: `(1)` full href, `(2)` the **cmid** (course-module id), `(3)` the quiz
name. `.strip()` the name.

> **The id here is a `cmid` (course module id), not a quiz id.** It is what every downstream
> URL uses (`view.php?id=`, `attempt.php?cmid=`, `processattempt.php?cmid=`). Keep the naming
> straight in the port — the Python code calls it `quiz_id` in some places and `cmid` in
> others, and they are the same number.

**⚠️ Performance trap:** for each quiz found, the current code then fetches that quiz's page to
get its status (§4.3) — **serially, in the same request**. A course with 15 quizzes = 16
sequential HTTP roundtrips before the endpoint responds. This is the single slowest part of the
dashboard. In the port, run these **concurrently** with `Promise.all` (see §7.6).

**Returned shape:**

```json
[
  {
    "id": "42",
    "name": "Week 3 Quiz",
    "url": "/mod/quiz/view.php?id=42",
    "status": { "status": "Finished", "marks": "8.00/10.00", "grade": "80.00 out of 100.00" }
  }
]
```

Note `id` is a **string** here (it comes straight out of a regex group), while course `id` is
a number. The frontend tolerates both. Normalise in the port.

### 4.3 Quiz attempt status — scraped from the quiz page

```
GET {base}/mod/quiz/view.php?id={cmid}
```

The quiz view page shows a summary table of previous attempts. Parsing strategy:

1. **Split the HTML into per-attempt blocks** on the literal string `<li class="col`.
   If the split yields ≤ 1 element, treat the whole page as a single block.
   *(This is theme-dependent — Boost renders attempts in a list. If a theme does not use it,
   the whole-page fallback still usually works because the regexes are anchored on `<th>`
   labels.)*
2. For each block, find the attempt number; skip blocks without one:
   ```python
   re.search(r'Attempt\s+(\d+)', block, re.IGNORECASE)
   ```
3. Extract the three fields:
   ```python
   status_match = re.search(r'<th[^>]*>\s*Status\s*</th>\s*<td[^>]*>([^<]+)</td>', block, re.IGNORECASE)
   marks_match  = re.search(r'<th[^>]*>\s*Marks\s*</th>\s*<td[^>]*>([^<]+)</td>',  block, re.IGNORECASE)
   grade_match  = re.search(r'<th[^>]*>\s*Grade\s*</th>\s*<td[^>]*>(.*?)</td>',    block, re.IGNORECASE)
   ```
   `status` defaults to `"Finished"` when absent. `marks`/`grade` default to `None`.
   The **grade** value may contain nested markup, so it is cleaned:
   ```python
   grade = re.sub(r'<[^>]*>', '', grade).strip()
   grade = re.sub(r'\s+', ' ', grade)
   ```
4. Sort attempts by number ascending, **return the last (highest-numbered) one**.
5. **If no attempt blocks were found**, fall back to sniffing button text on the page:
   - page contains `"Attempt quiz"` → `{"status": "Not attempted"}`
   - page contains `"Continue your attempt"` → `{"status": "In progress"}`
   - otherwise → `{"status": "Not attempted"}`
6. **Any exception is swallowed** and returned as `{"status": "Error ({e})", …}` so one broken
   quiz cannot break the whole course listing. Preserve this behaviour.

**Status strings the frontend recognises** (case-insensitive substring match):

| Contains | UI class | Label |
| --- | --- | --- |
| `progress` | `in-progress` | In progress |
| `finished` | `finished` | Finished |
| anything else | `not-attempted` | Not attempted |

A quiz whose status is exactly `finished` (lowercased) is **excluded from "Solve All"** and its
Solve button is replaced by a disabled "Finished" button.

---

## 5. The solver — full algorithm

This is `solve_quiz_generator(base_url, sesskey, cookie_jar, cmid, api_key)` in `web.py`.
It is a Python generator that `yield`s JSON strings, which the route wraps as SSE frames.
Below is the exact sequence. Each ▸ marks an event emitted to the client (§6).

### Phase 0 — Resolve or create an attempt

▸ `{"status": "Connecting to Moodle..."}`

```
GET {base}/mod/quiz/view.php?id={cmid}
```

**Is there an attempt already in progress?**

```python
re.search(r'name="attempt"\s+value="(\d+)"', quiz_html)
```

- **Match → resume.** ▸ `{"status": "Found In Progress attempt ID: {id}. Resuming..."}`
  Attempt URL becomes `{base}/mod/quiz/attempt.php?attempt={attempt_id}&cmid={cmid}`.

- **No match → start a new attempt.** Find the start form:
  ```python
  re.search(r'<form[^>]*action="[^"]*startattempt\.php"[^>]*>(.*?)</form>', quiz_html, re.DOTALL)
  ```
  If absent → ▸ `{"error": "Could not find start attempt button or in-progress attempt."}` and stop.

  Collect **all** its inputs into the POST body:
  ```python
  re.findall(r'<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"', start_form.group(1))
  ```
  Then **overwrite `sesskey`** with the known-good session value (guards against stale HTML).

  ▸ `{"status": "No active attempts. Starting new quiz attempt..."}`

  ```
  POST {base}/mod/quiz/startattempt.php
  Content-Type: application/x-www-form-urlencoded
  ```
  Moodle **redirects** to the attempt page. The Python code reads the *final* URL after
  redirects (`response.geturl()`) and pulls the attempt id out of it:
  ```python
  re.search(r'attempt=(\d+)', attempt_url)
  ```
  If that fails → ▸ `{"error": "Failed to obtain attempt ID after starting quiz."}`.

  ▸ `{"status": "Started attempt ID {attempt_id}."}`

> **Port note:** this step depends on reading the URL *after* redirect following. In Node
> `fetch`, `res.url` gives you that when `redirect: 'follow'`. If you implement manual redirect
> following to capture cookies at each hop (recommended, §7.4), track the final `Location`
> yourself.

### Phase 0.5 — Discover the page count

Fetch the attempt URL, then:

```python
pages_found = re.findall(r'data-quiz-page="(\d+)"', first_page_html)
max_page = max(int(p) for p in pages_found) if pages_found else 0
```

Total pages = `max_page + 1`. Pages are **0-indexed** in Moodle URLs.

▸ `{"status": "Found {max_page+1} pages in this quiz. Harvesting questions..."}`

### Phase 1 — Harvest every question (read-only pass)

For `p` in `0..max_page`:

▸ `{"status": "Harvesting page {p+1} of {max_page+1}..."}`

```
GET {base}/mod/quiz/attempt.php?attempt={attempt_id}&cmid={cmid}&page={p}
```

**Split the page into question blocks** on the literal `<div id="question-`, discard the first
fragment (everything before the first question), and re-prefix each fragment so the regexes
below still see a well-formed opening tag:

```python
question_parts = p_html.split('<div id="question-')[1:]
for part in question_parts:
    part_html = '<div id="question-' + part
```

Per question:

- **Question number:** `re.search(r'class="qno">(\d+)', part_html)`; fall back to a running counter.
- **Question text:** `extract_qtext(part_html)` — see §5.1.
- **Choices:** split the block on the literal `<div class="r` (dropping index 0 — Moodle
  alternates `r0`/`r1` classes per answer row), then per fragment:
  ```python
  letter_match = re.search(r'<span[^>]*class="answernumber">([a-zA-Z])\.?\s*</span>', c_part)
  text_match   = re.search(r'<div[^>]*class="flex-fill[^"]*">([^<]+)</div>', c_part)
  ```
  Keep the pair only if **both** match. Letter is lowercased and stripped.

Questions with zero parsed choices are skipped entirely — this is how non-MCQ question types
(essay, numeric, matching) get silently ignored.

`time.sleep(0.1)` between pages. **Drop this in the port** (§7.6).

If nothing was harvested → ▸ `{"error": "No multiple-choice questions found in this quiz."}`

### 5.1 `extract_qtext` — the question-text extractor

Regex alone is unreliable across Moodle themes, so this uses index arithmetic:

1. Find `class="qtext"`. If absent → return `"Unknown question"`.
2. Content starts at the first `>` after that index.
3. Content **ends** at the earliest occurrence of any of these markers after the start:
   `class="ablock"`, `class="prompt"`, `class="r0"`, `class="r1"`, `class="outcome"`,
   `class="comment"`. If any were found, back up to the last `<` before that index so the
   closing tag is not included. If none were found, run to end of block.
4. Strip screen-reader-only helper text, which otherwise pollutes the prompt sent to the LLM:
   ```python
   re.sub(r'<([a-zA-Z0-9]+)[^>]*\b(accesshide|sr-only|visually-hidden)\b[^>]*>.*?</\1>', '',
          qtext_raw, flags=re.DOTALL | re.IGNORECASE)
   ```
   > **This uses a backreference `\1` to match the closing tag.** JavaScript supports `\1` in
   > regex literals identically, so it ports as-is with flags `gsi`.
5. Strip all remaining tags (`<[^>]*>` → empty) and collapse whitespace (`\s+` → single space).

### 5.2 Groq API call — one batched request for the whole quiz

```
POST https://api.groq.com/openai/v1/chat/completions
Authorization: Bearer {GROQ_API_KEY}
Content-Type: application/json
```

**Request body:**

```json
{
  "model": "llama-3.1-8b-instant",
  "messages": [{ "role": "user", "content": "<prompt>" }],
  "temperature": 0.0,
  "response_format": { "type": "json_object" }
}
```

**Prompt construction.** Each question is rendered as:

```
Question {qno}:
{question text}

Choices:
a) first choice
b) second choice
```

joined with a `\n\n---\n\n` separator, then wrapped:

```
Solve the following multiple-choice questions:

{questions_block}

Identify the correct option letter for each question. Return the answers as a single JSON
object mapping the question number (as a string) to the correct option letter. For example:
{"1": "a", "2": "c"}

Do not write explanations, introductions, markdown tags, or any text other than the valid
JSON object. Output ONLY the raw JSON object.
```

**Response:** standard OpenAI-compatible envelope. Read
`res.choices[0].message.content`, trim it, and `JSON.parse` it. Result is
`{ "1": "a", "2": "c", ... }` — **string keys, lowercase letter values**.

Any failure → error message `"Batch Groq API call failed: {e}"`.

▸ `{"status": "Sending all {N} questions to Groq AI in a single batch query..."}`
▸ `{"thinking": true}` — emitted immediately before the call so the UI can show a spinner.

> **`main.py` has a per-question variant** (`query_groq`) that omits `response_format`, asks for
> a bare letter, and post-processes with `.replace(")","").replace(".","").strip()[0]`. Keep it
> in mind as a fallback if `json_object` mode misbehaves on a given model. The model id is
> hardcoded today — make it configurable in the port.

▸ `{"status": "Batch answers computed successfully! Submitting answers page-by-page..."}`

### Phase 2 — Submit, page by page

**The pages are fetched a second time.** This is deliberate and necessary: the POST payload
needs the *current* `sequencecheck` values and the real input `name`/`value` attributes, which
the harvest pass did not record.

For `p` in `0..max_page`:

▸ `{"status": "Submitting Page {p+1} of {max_page+1}..."}`

```
GET {base}/mod/quiz/attempt.php?attempt={attempt_id}&cmid={cmid}&page={p}
```

1. **Find the form action:**
   ```python
   re.search(r'<form[^>]*action="([^"]+)"[^>]*id="responseform"', p_html)
   ```
   Missing → ▸ `{"error": "Could not find response form on page {p+1}."}`, stop.

2. **Collect hidden inputs into the payload:**
   ```python
   re.findall(r'<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"', p_html)
   ```
   Each name and value is passed through `urllib.parse.unquote(...)`, then **skipped if the
   name matches** `^q\d+:\d+(_|:)` — per-question fields are excluded here, and the ones that
   are actually needed get re-added deliberately in the next step.

   > **⚠️ Quirk worth flagging.** `unquote` is *percent*-decoding, but HTML attributes are
   > *entity*-encoded. So `&amp;` survives as `&amp;`, while a literal `%3A` in a field name
   > would be turned into `:`. This is almost certainly not what was intended. In the port,
   > decode HTML entities (`&amp; &lt; &gt; &quot; &#39;`) instead — but **test against a real
   > quiz**, because the existing behaviour is what currently works.

3. **Per question block** (same split as Phase 1):
   - Re-read the question number from `class="qno">(\d+)`; fall back to `p + 1`.
   - **Add the sequence check** — Moodle rejects submissions carrying a stale one:
     ```python
     re.search(r'name="([^"]+:[^"]+:sequencecheck)"[^>]*value="([^"]*)"', part_html)
     ```
   - **Re-parse the choices, this time capturing the actual input control:**
     ```python
     input_match  = re.search(r'<input[^>]*type="(?:radio|checkbox)"[^>]*name="([^"]+)"[^>]*value="([^"]+)"', c_part)
     letter_match = re.search(r'<span[^>]*class="answernumber">([a-zA-Z])\.?\s*</span>', c_part)
     text_match   = re.search(r'<div[^>]*class="flex-fill[^"]*">([^<]+)</div>', c_part)
     ```
     All three must match.
   - **Look up the answer:** `batch_answers.get(str(qno), "a")` — note the **default is `"a"`**
     when the LLM omitted a question.
   - ▸ `{"question": ..., "qno": ..., "choices": [{"letter","text"}, ...]}`
   - Select the choice whose letter matches; **if no letter matches, fall back to the first
     choice.** The solver never leaves a question blank.
   - ▸ `{"answer": "<letter>", "text": "<choice text>"}`
   - Set `payload[selected.input_name] = selected.input_val`.

4. **Add `payload["next"] = "Next page"`** and POST the whole thing:
   ```
   POST {form_action}
   Content-Type: application/x-www-form-urlencoded
   ```
   (`form_action` is an absolute URL taken from the page.)

`time.sleep(0.5)` between pages. **Drop this in the port.**

### Phase 3 — Finalise the attempt

▸ `{"status": "Finalizing and submitting quiz attempt..."}`

```
POST {base}/mod/quiz/processattempt.php?cmid={cmid}
Content-Type: application/x-www-form-urlencoded

attempt={attempt_id}&finishattempt=1&scrollpos=0&sesskey={sesskey}
```

The response body is the **review page**. Scrape the result out of it with the same two
patterns used in §4.3 (`Marks`, `Grade`), defaulting both to `"N/A"`, and clean the grade of
markup.

▸ `{"success": "Quiz submitted successfully!", "grade": "...", "marks": "..."}`

Any failure at any stage → ▸ `{"error": "<message>"}` and the run ends.

---

## 6. Current HTTP surface & the SSE event contract

### 6.1 Endpoint table (as it exists today)

| Method | Path | Auth transport | Returns |
| --- | --- | --- | --- |
| `GET` | `/` | — | `static/index.html` |
| `GET` | `/static/*` | — | Static assets (mounted dir) |
| `GET` | `/api/status` | 3 headers | `{authenticated, username, moodle_url}` or `{authenticated:false, error}` |
| `GET` | `/api/courses` | 3 headers | Array of Moodle course objects, or `{error}` |
| `GET` | `/api/courses/{course_id}/quizzes` | 3 headers | Array of quiz objects, or `{error}` |
| `GET` | `/api/solve-stream?cmid=…` | **4 query params** | `text/event-stream` |

**Error convention:** every JSON endpoint catches exceptions and returns
**HTTP 200 with an `{"error": "..."}` body** rather than a 4xx/5xx. The frontend checks
`data.error` before it checks status codes. `/api/solve-stream` is the exception — it raises a
real `500` if authentication fails *before* the stream opens.

Missing credentials produce `{"error": "Moodle host configuration missing."}` on the data
endpoints and `{"authenticated": false}` on `/api/status`.

### 6.2 SSE frame format

Each yielded JSON object is wrapped as a standard SSE data frame:

```
data: {"status":"Harvesting page 1 of 3..."}\n\n
```

The client uses the browser `EventSource` API and `JSON.parse`s `event.data`. There are **no
named events** — everything arrives on the default `message` channel and is discriminated by
which key is present.

### 6.3 Event schema — the full vocabulary

| Key | Payload | Client behaviour |
| --- | --- | --- |
| `status` | string | Append log line; set the status summary text |
| `thinking` | `true` | Show the "Groq LLM is thinking…" animated indicator |
| `question` | string, plus `qno` (number) and `choices` (`[{letter,text}]`) | Render the focus card with all choices listed |
| `answer` | letter string, plus `text` | Log the pick; highlight the matching choice element (`#choice-{letter}`) and clear the thinking indicator |
| `success` | message string, plus `grade`, `marks` | Log success, set summary to `Completed! Grade: …`, re-enable the close button, refresh the quiz list |
| `error` | message string | Log error, set summary, re-enable close, refresh the quiz list |

**Terminal conditions:** the client closes the `EventSource` when it sees either `success` or
`error`. Nothing else ends the stream. An `onerror` from the transport itself logs
`"Connection interrupted or closed."` and also closes.

> **Note:** `EventSource` auto-reconnects on transport failure. The current code suppresses that
> by closing the source inside `onerror` — be deliberate about this in the port, because an
> auto-reconnect would **restart the solve from scratch** and could double-submit an attempt.

### 6.4 Frontend behaviours worth preserving

- **On load:** read the four `localStorage` keys into the config form (Moodle URL defaults to
  `http://localhost:8080`), then call `/api/status` and `/api/courses`.
- **Config form submit:** save all four keys, clear the current course selection, re-fetch
  status + courses.
- **Course click:** load that course's quizzes; the panel header shows the course name and
  `Course ID: {id}`.
- **"Solve All Pending":** visible only when at least one quiz's status is not `finished`.
  Runs the pending quizzes **strictly sequentially**, awaiting each stream to terminate, with a
  **2-second cooldown** between quizzes (logged as `"Waiting 2 seconds before starting next
  quiz..."`). The button is disabled for the duration. On completion the quiz list reloads.
  A failure in one quiz is caught, logged, and the loop continues to the next.
- **Terminal modal:** the close button is **disabled while a solve is running** and re-enabled
  on `success`/`error`. Closing the terminal aborts the stream.
- **Refresh control:** re-fetches status, and either the current course's quizzes or the course
  list.
- **Skeleton loaders** while courses/quizzes are loading.

> **⚠️ Security note for the rewrite:** the current frontend interpolates Moodle-supplied
> strings (course names, quiz names, question text, choice text) straight into `innerHTML`.
> That is a stored-XSS path from any Moodle content author. In React the problem disappears
> **as long as you never reach for `dangerouslySetInnerHTML`.** Do not reintroduce it.

### 6.5 UI structure to rebuild

Three regions:

1. **Left sidebar (fixed on desktop):** logo, connection status indicator (active/inactive dot
   + "Connected"/"Disconnected"/"Auth Error"), user avatar with 2-letter initials, the Moodle
   host display, and the config form (URL, username, password, Groq key).
2. **Main area:** course card grid (shortname as code, fullname as title, active state on
   selection), then the quiz list — one row per quiz with title, `Module ID: {id}`, a status
   badge, optional `Marks:` and `(grade)`, and a Solve button (or a disabled "Finished").
3. **Solver terminal (modal/overlay):** title `Solving {quiz name}`, a scrolling monospaced log
   of `[timestamp] message` entries in four tones (default/info/success/error), a "focus card"
   showing the current question and its choices with the AI-selected one highlighted, a status
   summary line, and a close/dismiss action.

**Design tokens** (`DESIGN.md`): dark, OKLCH, neon teal `--primary` `oklch(0.75 0.18 190)`,
cyber blue `--secondary` `oklch(0.65 0.16 230)`, surfaces `oklch(0.14 0.01 200)` /
`oklch(0.18 0.015 200)`. **Card radius is exactly 10px** and must not exceed 12px (explicit
anti-reference in `PRODUCT.md`). Hover = border shifts to primary/secondary + `translateY(-2px)`.
Inter for UI, monospace for the log panel. Respect `prefers-reduced-motion`.

**shadcn mapping:** `Card` (courses), `Table` or plain rows (quizzes), `Badge` (status tags),
`Button`, `Input`/`Label`/`Form` (config), `Dialog` or `Sheet` (solver terminal), `ScrollArea`
(log), `Skeleton` (loaders), `Sonner` (toasts). Override the default shadcn radius to `10px`
and map the OKLCH palette onto the shadcn CSS variables rather than fighting them.

---

## 7. The Next.js + Vercel target architecture

### 7.1 Non-negotiable constraint: everything Moodle-facing must be server-side

**The browser cannot talk to Moodle directly.** Do not attempt a pure-client rewrite. Two
independent blockers, neither fixable from your side:

1. **CORS.** The app works by *reading response bodies* — regexing `logintoken` out of the login
   page, `sesskey` out of the dashboard, question markup out of attempt pages. Moodle sends no
   `Access-Control-Allow-Origin` for your Vercel domain, so the browser will refuse to hand you
   any of those bodies.
2. **Cookies.** Moodle's `MoodleSession` cookie is not set with `SameSite=None; Secure`, so
   browsers will not attach it on cross-site requests — and third-party cookie blocking in
   Chrome/Safari finishes the job. The entire cookie-jar flow depends on that cookie.

So the shape is **client-driven, server-proxied**:

- **Client holds all state.** Four credentials in `localStorage`, exactly as today. No database,
  no server sessions, no secrets in Vercel env vars.
- **Client owns the orchestration loop** for the solver.
- **Each route handler is a thin stateless proxy.** It receives credentials in the POST body,
  performs the Moodle roundtrip server-side (server-to-server fetch has no CORS), returns
  parsed JSON, and forgets everything.

Credentials therefore transit your Vercel function on every request — they are just never
persisted there. Practically the same trust model as running it on localhost.

**One exception worth testing:** Groq may permit direct browser calls (their SDK exposes a
`dangerouslyAllowBrowser` flag, which implies CORS headers are present — *verify this, it is
not confirmed*). If it works, call Groq straight from the client: it is the user's own key in
the user's own browser, and it removes the longest single I/O wait from your function budget.
The Moodle half still has to be proxied regardless.

### 7.2 Runtime configuration

```ts
// every Moodle-facing route handler
export const runtime = 'nodejs'      // NOT edge — you need full Node HTTP + cookie handling
export const maxDuration = 300       // seconds; Hobby's ceiling
export const dynamic = 'force-dynamic'
```

**Fluid compute is enabled by default on new Vercel projects** and is what raises Hobby's
duration ceiling to 300s. Confirm it is on in Project Settings → Functions. Do not use the Edge
runtime: it must begin streaming within 25s to hold a connection past that point, and you lose
the Node APIs that make cookie handling straightforward.

`iad1` (US East) is the default and only region available on Hobby — see §7.7.

### 7.3 Proposed route structure

Replace the single long-lived SSE endpoint with a set of short, resumable calls the client
drives. This is the most important structural change in the migration.

```
app/
  page.tsx                              # dashboard (client component)
  api/
    status/route.ts                     # POST -> { authenticated, username, moodleUrl }
    courses/route.ts                    # POST -> Course[]
    courses/[courseId]/quizzes/route.ts # POST -> Quiz[]
    solve/
      start/route.ts                    # POST -> { attemptId, totalPages, questions[] }
      submit-page/route.ts              # POST -> { page, submitted[] }
      finish/route.ts                   # POST -> { grade, marks }
lib/
  moodle/
    cookie-jar.ts                       # §7.4
    client.ts                           # fetch wrapper: UA header, jar, redirects
    auth.ts                             # login handshake -> { sesskey, cookies }
    courses.ts                          # AJAX call + parsing
    quizzes.ts                          # course page + status scraping
    attempt.ts                          # start/resume, harvest, submit, finalise
    parse.ts                            # all regexes + extractQText, in one place
  groq.ts                               # batch solve call
types.ts
```

**Everything moves from GET to POST** so credentials travel in the JSON body instead of the
query string. This fixes the log-leakage defect in §2.2 and removes the `EventSource`
limitation that caused it.

**Suggested request body** (shared by every route):

```ts
type Creds = {
  moodleUrl: string
  username: string
  password: string
  groqApiKey?: string   // only the solve routes need it
}
```

**Suggested solver flow, driven from the client:**

| Call | Does | Typical duration |
| --- | --- | --- |
| `solve/start` | Login → resume-or-start attempt → discover page count → harvest **all** pages → call Groq → return the answer map + parsed questions | The longest step; dominated by page count + one LLM call |
| `solve/submit-page` × N | Login → fetch page `p` → build payload → POST it | A few seconds each |
| `solve/finish` | Login → `processattempt.php` → scrape grade/marks | Seconds |

Each call is independently well under 300s even for a large quiz, the client can retry a single
failed page instead of restarting, and the UI log stays live because the client appends an entry
per resolved call. Pass `attemptId`, `cmid`, and the answer map between calls — the client is
the state store.

**If you prefer to keep a single streaming endpoint**, it is now viable within 300s: use a
`POST` route returning a `ReadableStream` and read it client-side with
`fetch()` + `response.body.getReader()` instead of `EventSource` (which cannot POST or set
headers). Keep the §6.3 event vocabulary either way — the UI logic ports unchanged. The
tradeoff is that a timeout leaves an attempt half-submitted with no resume path.

### 7.4 Cookie handling — the part with no direct Node equivalent

Python's `http.cookiejar.CookieJar` + `HTTPCookieProcessor` transparently stored cookies and
replayed them across redirects. Node's `fetch` has **no cookie jar at all** and will not expose
`Set-Cookie` from intermediate redirect hops. You must handle this yourself.

**Option A (recommended, zero deps).** Follow redirects manually so you can capture cookies at
every hop *and* observe the final URL (needed by §5 Phase 0):

```ts
type Jar = Map<string, string>

function absorb(jar: Jar, res: Response) {
  // Node 18+/undici: getSetCookie() returns ALL Set-Cookie headers, not just the first
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';')
    const idx = pair.indexOf('=')
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
  }
}

function cookieHeader(jar: Jar) {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
}

async function req(jar: Jar, url: string, init: RequestInit = {}) {
  let current = url
  for (let hop = 0; hop < 10; hop++) {
    const res = await fetch(current, {
      ...init,
      redirect: 'manual',
      headers: {
        'User-Agent': UA,
        ...(jar.size ? { Cookie: cookieHeader(jar) } : {}),
        ...init.headers,
      },
    })
    absorb(jar, res)
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current).toString()
      init = { method: 'GET', body: undefined }  // redirects downgrade POST to GET
      continue
    }
    return { res, finalUrl: current, html: await res.text() }
  }
  throw new Error('Too many redirects')
}
```

`res.headers.getSetCookie()` is essential — `headers.get('set-cookie')` collapses multiple
cookies into one string and will corrupt the jar.

**Option B.** `tough-cookie` + `fetch-cookie`. Closer to the Python semantics (domain/path
scoping, expiry) at the cost of two dependencies. Fine if Option A misbehaves against your
Moodle's redirect chain.

**Do not port `SESSION_CACHE`.** A module-level dict is nondeterministic on serverless: warm
instances may hit it, cold ones will not. Choose one:

- **Simplest and recommended: re-login on every request.** Costs 2 extra roundtrips (~0.5–1s).
  Given the client-driven design already makes many small calls, this is the honest default.
- **Better if login latency hurts:** return the serialised cookie jar + sesskey to the client
  after the first call and have it pass them back on subsequent calls, re-logging in only on
  failure. The client already holds the password, so this leaks nothing new — but it does put a
  live Moodle session token in `localStorage`, so weigh that.
- **Do not** reach for Upstash/KV for this. It adds a dependency and a second place secrets can
  live, for a 10-minute cache.

### 7.5 Porting the regexes

Python `re` → JavaScript `RegExp` is near-1:1 here. The mapping:

| Python | JavaScript | Note |
| --- | --- | --- |
| `re.DOTALL` | `s` flag | `.` matches newlines |
| `re.IGNORECASE` | `i` flag | |
| `re.search(p, s)` | `s.match(re)` / `re.exec(s)` | Returns `null` when absent — check it |
| `re.findall(p, s)` with groups | `[...s.matchAll(re)]` with `g` flag | Each item is a match array; groups at `[1]`, `[2]`, … |
| `re.sub(p, '', s)` | `s.replace(re, '')` with `g` flag | **`g` is required** — Python `re.sub` replaces all by default, JS `replace` without `g` replaces only the first |
| `\1` backreference | `\1` | Identical syntax; used by the accesshide stripper |
| `str.split(lit)[1:]` | `str.split(lit).slice(1)` | |

**The `g`-flag difference is the most likely source of a silent porting bug.** Both tag-stripping
substitutions and the whitespace collapse need `g`.

Also: a `g`-flagged regex object carries `lastIndex` state across calls. Do not share one
`g`-flagged instance between `matchAll` loops and `test`/`exec` calls — build them fresh or keep
`matchAll` (which clones internally) as the only consumer.

Put every pattern in `lib/moodle/parse.ts` as named exports. When a Moodle theme upgrade breaks
scraping — and it will — one file is the blast radius.

### 7.6 Performance: what to change while porting

- **Delete every `time.sleep`.** The `0.1s` between harvested pages and `0.5s` between submitted
  pages contribute nothing but burn Provisioned Memory (§7.7), which is the metered resource.
- **Parallelise quiz-status lookups.** §4.2 currently does 1 + N sequential roundtrips. Use
  `Promise.all` over the quiz list — for 15 quizzes that is roughly 16× faster and turns the
  slowest endpoint in the app into the fastest. Cap concurrency at ~5–8 so you do not hammer
  the Moodle box.
- **Harvest pages concurrently too** (Phase 1 is read-only, so ordering does not matter).
  **Do not parallelise Phase 2 submissions** — they mutate attempt state and Moodle's
  `sequencecheck` will reject out-of-order posts.

### 7.7 Vercel Hobby limits — verified against current docs

| Resource | Hobby limit | Impact here |
| --- | --- | --- |
| **Max function duration** | **300s** (default *and* maximum, with Fluid compute) | Fits the workload; drives the §7.3 split |
| Memory / CPU | 2 GB / 1 vCPU (fixed) | Regex over HTML strings — irrelevant |
| **Active CPU** | 4 CPU-hrs/month | **Barely touched.** Active CPU excludes I/O wait, and this app is ~95% waiting on Moodle and Groq |
| **Provisioned Memory** | 360 GB-hrs/month | **The real meter.** Wall-clock × 2 GB → ~180 hours of function time/month. A 3-minute solve costs 0.1 GB-hr ⇒ **~3,000+ full solves/month** |
| Invocations | 1M/month | Not a factor |
| Fast Data Transfer | 100 GB/month | Not a factor |
| Fast Origin Transfer | 10 GB/month | Not a factor |
| Request/response body | 4.5 MB | Fine — return **parsed JSON, never raw Moodle HTML** |
| Regions | `iad1` only on Hobby | See below |

**You will not come close to any of these.** The free tier is comfortable for this workload.

### 7.8 Gotchas that could actually bite

1. **Datacenter IPs.** Functions egress from rotating AWS IPs in US-East. Your Moodle will see
   logins from Virginia rather than from your usual location, and repeated logins from
   datacenter ranges are exactly what security plugins flag. Static IPs are not available on
   Hobby. **Test this first** with a single `/api/status` call before building anything on top —
   it is the one remaining thing that can invalidate the whole approach.
2. **Repeated logins can trigger Moodle lockout.** Default Moodle locks an account after N
   failed attempts. If you go with re-login-per-request (§7.4), a wrong password typed once
   could produce a burst of failures. Fail fast and stop retrying on an auth error.
3. **Hobby is non-commercial personal use only.** No ads, no payments, no donation links —
   donations explicitly count as commercial. Fine as-is; just do not monetise it.
4. **Moodle theme coupling.** Every selector in §4 and §5 assumes Boost-like markup
   (`instancename`, `qtext`, `answernumber`, `flex-fill`, `data-quiz-page`). A theme change or
   major Moodle upgrade breaks scraping silently — parsers return empty rather than throwing.
   Add a sanity check: if a page yields zero questions but the HTML is non-trivial in length,
   surface a distinct "parser may be out of date" error rather than "no MCQs found".
5. **Non-MCQ questions are silently skipped**, and any question the LLM omits **defaults to
   answer "a"**. Both are deliberate today. Consider surfacing them in the UI instead.
6. **`docker-compose.yml` is local-only.** A Vercel function cannot reach `localhost:8080`.
   The target Moodle must be publicly reachable — confirmed to be the case.

### 7.9 Migration checklist

- [ ] Scaffold routes and `lib/moodle/*` per §7.3.
- [ ] Port the cookie jar (§7.4) and verify the login handshake end-to-end against the real
      Moodle **from a deployed preview**, not just locally — the IP question in §7.8 only shows
      up in the cloud.
- [ ] Port all regexes into `lib/moodle/parse.ts`, minding the `g` flag (§7.5).
- [ ] Port `extractQText` verbatim, including the accesshide stripper.
- [ ] `/api/status` → `/api/courses` → `/api/courses/[id]/quizzes`, with parallel status lookups.
- [ ] Groq batch call; make the model id configurable.
- [ ] Solver split into `start` / `submit-page` / `finish`; client drives the loop.
- [ ] Rebuild the UI on shadcn with the `DESIGN.md` tokens; keep the §6.3 event vocabulary as
      the log's data model.
- [ ] Set `runtime`, `maxDuration`, `dynamic` on every Moodle-facing route.
- [ ] Verify no credentials appear in any URL (check Vercel's request logs after a solve run).
- [ ] Test against a multi-page quiz and a quiz with an already-in-progress attempt.

### 7.10 Source-of-truth pointers

- Backend logic to port: `src/web.py` (all 621 lines; `main.py` only for the fallback prompt).
- UI behaviour: `src/static/app.js`.
- Visual system: `DESIGN.md` (tokens, type scale, component rules) and `PRODUCT.md`
  (personality, anti-references, accessibility).
- Local Moodle 4.5 test instance: `docker-compose up` → `http://localhost:8080`. Useful for
  exercising the parsers without touching a real course.
