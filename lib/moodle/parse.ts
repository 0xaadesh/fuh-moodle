/**
 * Every pattern the scrapers depend on, in one file. When a Moodle theme
 * upgrade breaks scraping — and it will — this is the blast radius.
 *
 * Selectors assume Boost-like markup: `instancename`, `qtext`, `answernumber`,
 * `flex-fill`, `data-quiz-page`.
 *
 * g-flagged regexes carry `lastIndex` state across calls, so those are exposed
 * as factory functions and built fresh at each use site.
 */

// --- Auth ------------------------------------------------------------------

export const LOGIN_TOKEN = /name="logintoken"\s+value="([^"]+)"/
export const SESSKEY = /"sesskey":"([^"]+)"/

// --- Quiz listing (course page) --------------------------------------------

/**
 * Groups: 1 = href, 2 = cmid, 3 = quiz name.
 *
 * `[\s\S]` stands in for a dot under the `s` flag throughout this file — the
 * project targets ES2017, where that flag is not available.
 */
export const quizLinks = () =>
  /<a[^>]*href="([^"]*mod\/quiz\/view\.php\?id=(\d+))"[^>]*>[\s\S]*?<span class="instancename">([^<]+)/g

// --- Attempt status (quiz page / review page) -------------------------------

export const ATTEMPT_BLOCK_DELIMITER = '<li class="col'
export const ATTEMPT_NUMBER = /Attempt\s+(\d+)/i
export const STATUS_CELL = /<th[^>]*>\s*Status\s*<\/th>\s*<td[^>]*>([^<]+)<\/td>/i
export const MARKS_CELL = /<th[^>]*>\s*Marks\s*<\/th>\s*<td[^>]*>([^<]+)<\/td>/i
/** Grade may contain nested markup, hence `(.*?)`. The Python original did not
 * pass re.DOTALL here, so the match deliberately stays on one line. */
export const GRADE_CELL = /<th[^>]*>\s*Grade\s*<\/th>\s*<td[^>]*>(.*?)<\/td>/i

// --- Attempt lifecycle ------------------------------------------------------

export const IN_PROGRESS_ATTEMPT = /name="attempt"\s+value="(\d+)"/
export const START_FORM =
  /<form[^>]*action="[^"]*startattempt\.php"[^>]*>([\s\S]*?)<\/form>/
export const formInputs = () => /<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g
export const ATTEMPT_ID_IN_URL = /attempt=(\d+)/
export const quizPages = () => /data-quiz-page="(\d+)"/g

// --- Question blocks --------------------------------------------------------

export const QUESTION_BLOCK_DELIMITER = '<div id="question-'
/** Moodle alternates r0/r1 classes per answer row. */
export const CHOICE_DELIMITER = '<div class="r'

export const QNO = /class="qno">(\d+)/
export const ANSWER_NUMBER = /<span[^>]*class="answernumber">([a-zA-Z])\.?\s*<\/span>/
/**
 * Captures across nested markup rather than stopping at the first `<`.
 * Moodle's editor routinely wraps option text in `<p>`, `<code>` or `<span>`,
 * and a text-only capture would truncate it — or fail outright and silently
 * drop the option, which shifts every letter after it.
 *
 * Run the result through {@link cleanContentText}.
 */
export const CHOICE_TEXT = /<div[^>]*class="flex-fill[^"]*">([\s\S]*?)<\/div>/
export const CHOICE_INPUT =
  /<input[^>]*type="(?:radio|checkbox)"[^>]*name="([^"]+)"[^>]*value="([^"]+)"/

// --- Submission -------------------------------------------------------------

export const RESPONSE_FORM_ACTION = /<form[^>]*action="([^"]+)"[^>]*id="responseform"/
export const hiddenInputs = () =>
  /<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g
/** Per-question fields are excluded from the hidden-input sweep; the ones that
 * are actually needed get re-added deliberately per question block. */
export const PER_QUESTION_FIELD = /^q\d+:\d+(_|:)/
export const SEQUENCE_CHECK = /name="([^"]+:[^"]+:sequencecheck)"[^>]*value="([^"]*)"/

// --- Cleaners ---------------------------------------------------------------

/** The backreference matches the closing tag. `g` is required — Python's
 * re.sub replaces all occurrences by default, JS `replace` without `g` does
 * only the first. */
const accessHide = () =>
  /<([a-zA-Z0-9]+)[^>]*\b(accesshide|sr-only|visually-hidden)\b[^>]*>[\s\S]*?<\/\1>/gi
const anyTag = () => /<[^>]*>/g
const whitespaceRun = () => /\s+/g

export function stripTags(html: string): string {
  return html.replace(anyTag(), "").trim()
}

export function collapseWhitespace(text: string): string {
  return text.replace(whitespaceRun(), " ")
}

/** Grade cells arrive with nested markup and ragged whitespace. */
export function cleanGrade(raw: string): string {
  return collapseWhitespace(stripTags(raw))
}

/**
 * Turn a fragment of Moodle content into the plain text a language model
 * should read: markup out, entities resolved, whitespace collapsed.
 *
 * Order matters. Tags are stripped *before* entities are decoded, so an
 * escaped `&lt;b&gt;` in the source survives as literal text instead of being
 * decoded into a tag and then thrown away.
 */
export function cleanContentText(html: string): string {
  return collapseWhitespace(decodeHtmlEntities(stripTags(html))).trim()
}

/**
 * HTML attributes are entity-encoded, not percent-encoded. The Python original
 * ran `urllib.parse.unquote` over input names and values, which decoded `%3A`
 * into `:` while leaving `&amp;` intact — almost certainly not the intent.
 * Decoding entities is the correct operation for markup-sourced strings.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    .replace(/&amp;/g, "&") // last, so &amp;lt; does not become <
}

// --- Block splitting --------------------------------------------------------

/** Split a page into per-question fragments, re-prefixing each one so the
 * regexes above still see a well-formed opening tag. */
export function splitQuestionBlocks(html: string): string[] {
  return html
    .split(QUESTION_BLOCK_DELIMITER)
    .slice(1)
    .map((part) => QUESTION_BLOCK_DELIMITER + part)
}

export function splitChoiceBlocks(questionHtml: string): string[] {
  return questionHtml.split(CHOICE_DELIMITER).slice(1)
}

// --- Question text ----------------------------------------------------------

const QTEXT_END_MARKERS = [
  'class="ablock"',
  'class="prompt"',
  'class="r0"',
  'class="r1"',
  'class="outcome"',
  'class="comment"',
]

/**
 * Regex alone is unreliable across Moodle themes, so this walks indices: find
 * the qtext container, take everything up to the earliest following structural
 * marker, then strip screen-reader-only helper text (which would otherwise
 * pollute the prompt sent to the LLM) and all remaining markup.
 */
export function extractQText(partHtml: string): string {
  const qtextIdx = partHtml.indexOf('class="qtext"')
  if (qtextIdx === -1) return "Unknown question"

  const startContentIdx = partHtml.indexOf(">", qtextIdx) + 1

  const endIndices = QTEXT_END_MARKERS.map((marker) =>
    partHtml.indexOf(marker, startContentIdx)
  ).filter((idx) => idx !== -1)

  let endContentIdx: number
  if (endIndices.length > 0) {
    endContentIdx = Math.min(...endIndices)
    // Back up to the last `<` so the closing tag is not included.
    const leftBracket = partHtml.lastIndexOf("<", endContentIdx)
    if (leftBracket !== -1 && leftBracket >= startContentIdx) {
      endContentIdx = leftBracket
    }
  } else {
    endContentIdx = partHtml.length
  }

  const raw = partHtml.slice(startContentIdx, endContentIdx).trim()
  return cleanContentText(raw.replace(accessHide(), ""))
}
