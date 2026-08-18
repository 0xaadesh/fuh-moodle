import type { MoodleSession } from "@/lib/moodle/auth"
import { FORM_CONTENT_TYPE, mapWithConcurrency, moodleRequest } from "@/lib/moodle/client"
import {
  ANSWER_NUMBER,
  ATTEMPT_ID_IN_URL,
  CHOICE_INPUT,
  CHOICE_TEXT,
  cleanContentText,
  cleanGrade,
  decodeHtmlEntities,
  extractQText,
  formInputs,
  GRADE_CELL,
  hiddenInputs,
  IN_PROGRESS_ATTEMPT,
  MARKS_CELL,
  PER_QUESTION_FIELD,
  QNO,
  quizPages,
  RESPONSE_FORM_ACTION,
  SEQUENCE_CHECK,
  splitChoiceBlocks,
  splitQuestionBlocks,
  START_FORM,
} from "@/lib/moodle/parse"
import type { Choice, HarvestedQuestion, SolverEvent } from "@/lib/types"

/** Phase 1 is read-only, so pages can be fetched in parallel. */
const HARVEST_CONCURRENCY = 4

/** Below this, an empty page is plausibly just an empty page. Above it, a page
 * that yields no questions means the selectors stopped matching. */
const PARSER_SANITY_HTML_LENGTH = 2000

export class ParserOutOfDateError extends Error {
  constructor(where: string) {
    super(
      `No questions could be parsed from ${where}, but the page has substantial content. ` +
        `The Moodle theme may have changed and the parser may be out of date.`
    )
    this.name = "ParserOutOfDateError"
  }
}

function attemptPageUrl(
  baseUrl: string,
  attemptId: string,
  cmid: string,
  page: number
): string {
  return `${baseUrl}/mod/quiz/attempt.php?attempt=${attemptId}&cmid=${cmid}&page=${page}`
}

// --- Phase 0: resolve or create an attempt ----------------------------------

export type ResolvedAttempt = {
  attemptId: string
  attemptUrl: string
  events: SolverEvent[]
}

/**
 * Resume the in-progress attempt if Moodle offers one, otherwise submit the
 * start-attempt form. Resuming matters: starting a second attempt while one is
 * open is both wrong and sometimes impossible.
 */
export async function resolveAttempt(
  { baseUrl, sesskey, jar }: MoodleSession,
  cmid: string
): Promise<ResolvedAttempt> {
  const events: SolverEvent[] = [{ status: "Connecting to Moodle..." }]

  const { html } = await moodleRequest(jar, `${baseUrl}/mod/quiz/view.php?id=${cmid}`)

  const inProgress = html.match(IN_PROGRESS_ATTEMPT)
  if (inProgress) {
    const attemptId = inProgress[1]
    events.push({ status: `Found In Progress attempt ID: ${attemptId}. Resuming...` })
    return {
      attemptId,
      attemptUrl: `${baseUrl}/mod/quiz/attempt.php?attempt=${attemptId}&cmid=${cmid}`,
      events,
    }
  }

  const startForm = html.match(START_FORM)
  if (!startForm) {
    throw new Error("Could not find start attempt button or in-progress attempt.")
  }

  const params = new URLSearchParams()
  for (const match of startForm[1].matchAll(formInputs())) {
    params.set(match[1], match[2])
  }
  // Overwrite with the known-good session value, guarding against stale HTML.
  params.set("sesskey", sesskey)

  events.push({ status: "No active attempts. Starting new quiz attempt..." })

  // Moodle redirects to the attempt page; the attempt id lives in that final URL.
  const { finalUrl } = await moodleRequest(jar, `${baseUrl}/mod/quiz/startattempt.php`, {
    method: "POST",
    headers: { "Content-Type": FORM_CONTENT_TYPE },
    body: params.toString(),
  })

  const idMatch = finalUrl.match(ATTEMPT_ID_IN_URL)
  if (!idMatch) {
    throw new Error("Failed to obtain attempt ID after starting quiz.")
  }

  events.push({ status: `Started attempt ID ${idMatch[1]}.` })
  return { attemptId: idMatch[1], attemptUrl: finalUrl, events }
}

// --- Phase 0.5: page count --------------------------------------------------

/** Pages are 0-indexed in Moodle URLs; this returns the count, not the max. */
export async function discoverPageCount(
  { jar }: MoodleSession,
  attemptUrl: string
): Promise<number> {
  const { html } = await moodleRequest(jar, attemptUrl)
  const pages = [...html.matchAll(quizPages())].map((m) => Number(m[1]))
  return pages.length > 0 ? Math.max(...pages) + 1 : 1
}

// --- Phase 1: harvest -------------------------------------------------------

function parseChoicesForHarvest(questionHtml: string): Choice[] {
  const choices: Choice[] = []
  for (const chunk of splitChoiceBlocks(questionHtml)) {
    const letter = chunk.match(ANSWER_NUMBER)
    const text = chunk.match(CHOICE_TEXT)
    // Both must match, or the fragment is not an answer row.
    if (letter && text) {
      choices.push({
        letter: letter[1].trim().toLowerCase(),
        text: cleanContentText(text[1]),
      })
    }
  }
  return choices
}

/**
 * Read-only pass over one attempt page. Questions with zero parsed choices are
 * skipped — that is how non-MCQ types (essay, numeric, matching) drop out.
 */
export async function harvestPage(
  { baseUrl, jar }: MoodleSession,
  attemptId: string,
  cmid: string,
  page: number,
  startingQno: number
): Promise<{ questions: HarvestedQuestion[]; htmlLength: number }> {
  const { html } = await moodleRequest(
    jar,
    attemptPageUrl(baseUrl, attemptId, cmid, page)
  )

  const questions: HarvestedQuestion[] = []
  for (const questionHtml of splitQuestionBlocks(html)) {
    const qnoMatch = questionHtml.match(QNO)
    const qno = qnoMatch ? Number(qnoMatch[1]) : startingQno + questions.length + 1
    const choices = parseChoicesForHarvest(questionHtml)
    if (choices.length > 0) {
      questions.push({ qno, question: extractQText(questionHtml), choices })
    }
  }

  return { questions, htmlLength: html.length }
}

export async function harvestAllPages(
  session: MoodleSession,
  attemptId: string,
  cmid: string,
  totalPages: number
): Promise<{ questions: HarvestedQuestion[]; events: SolverEvent[] }> {
  const pages = Array.from({ length: totalPages }, (_, page) => page)

  const results = await mapWithConcurrency(pages, HARVEST_CONCURRENCY, (page) =>
    // startingQno only matters for pages whose questions lack qno markup; with
    // concurrent fetches the fallback counter is per page, not global.
    harvestPage(session, attemptId, cmid, page, page)
  )

  const events: SolverEvent[] = results.map((result, page) => ({
    status: `Harvested page ${page + 1} of ${totalPages} — ${result.questions.length} question(s).`,
  }))

  const questions = results.flatMap((result) => result.questions)

  if (questions.length === 0) {
    const substantial = results.some(
      (result) => result.htmlLength > PARSER_SANITY_HTML_LENGTH
    )
    if (substantial) throw new ParserOutOfDateError("this quiz's attempt pages")
    throw new Error("No multiple-choice questions found in this quiz.")
  }

  return { questions, events }
}

// --- Phase 2: submit --------------------------------------------------------

type SubmittableChoice = Choice & {
  inputName: string
  inputValue: string
}

function parseChoicesForSubmit(questionHtml: string): SubmittableChoice[] {
  const choices: SubmittableChoice[] = []
  for (const chunk of splitChoiceBlocks(questionHtml)) {
    const input = chunk.match(CHOICE_INPUT)
    const letter = chunk.match(ANSWER_NUMBER)
    const text = chunk.match(CHOICE_TEXT)
    if (input && letter && text) {
      choices.push({
        inputName: input[1],
        inputValue: input[2],
        letter: letter[1].trim().toLowerCase(),
        text: cleanContentText(text[1]),
      })
    }
  }
  return choices
}

/**
 * Submit one page of answers.
 *
 * The page is fetched a second time here, deliberately: the POST needs the
 * current sequencecheck values and the real input name/value attributes, which
 * the harvest pass did not record.
 *
 * These calls must run in order — they mutate attempt state, and Moodle's
 * sequencecheck rejects out-of-order posts.
 */
export async function submitPage(
  { baseUrl, jar }: MoodleSession,
  attemptId: string,
  cmid: string,
  page: number,
  totalPages: number,
  answers: Record<string, string>,
  /** What the model actually saw, keyed by question number. Used to match the
   * chosen option by its text rather than trusting the letter to be stable. */
  harvested: HarvestedQuestion[] = []
): Promise<SolverEvent[]> {
  const events: SolverEvent[] = [
    { status: `Submitting Page ${page + 1} of ${totalPages}...` },
  ]

  const { html } = await moodleRequest(
    jar,
    attemptPageUrl(baseUrl, attemptId, cmid, page)
  )

  const formAction = html.match(RESPONSE_FORM_ACTION)
  if (!formAction) {
    throw new Error(`Could not find response form on page ${page + 1}.`)
  }

  const payload = new URLSearchParams()
  for (const match of html.matchAll(hiddenInputs())) {
    const name = decodeHtmlEntities(match[1])
    const value = decodeHtmlEntities(match[2])
    // Per-question fields are re-added deliberately below.
    if (!PER_QUESTION_FIELD.test(name)) {
      payload.set(name, value)
    }
  }

  for (const questionHtml of splitQuestionBlocks(html)) {
    const qnoMatch = questionHtml.match(QNO)
    const qno = qnoMatch ? Number(qnoMatch[1]) : page + 1

    // Moodle rejects submissions carrying a stale sequence check.
    const sequence = questionHtml.match(SEQUENCE_CHECK)
    if (sequence) {
      payload.set(decodeHtmlEntities(sequence[1]), decodeHtmlEntities(sequence[2]))
    }

    const choices = parseChoicesForSubmit(questionHtml)
    if (choices.length === 0) continue

    events.push({
      question: extractQText(questionHtml),
      qno,
      choices: choices.map(({ letter, text }) => ({ letter, text })),
    })

    // Default to "a" when the model omitted this question. The solver never
    // leaves a blank.
    const wanted = String(answers[String(qno)] ?? "a").trim().toLowerCase()
    const byLetter = choices.find((choice) => choice.letter === wanted)

    // Prefer matching on the option text the model actually read. Moodle can
    // re-order options between the harvest render and this one (the
    // shuffleanswers setting), which would make the letter point at a
    // different option than the one that was reasoned about.
    const wantedText = harvested
      .find((question) => question.qno === qno)
      ?.choices.find((choice) => choice.letter === wanted)?.text
    const byText = wantedText
      ? choices.find((choice) => choice.text === wantedText)
      : undefined

    const selected = byText ?? byLetter ?? choices[0]

    if (byText && byLetter && byText.letter !== byLetter.letter) {
      events.push({
        status:
          `Q${qno}: options were re-ordered since harvesting — the model chose "${wanted}" ` +
          `but that text is now "${byText.letter}". Following the text.`,
      })
    }

    events.push({ answer: selected.letter, text: selected.text })
    payload.set(selected.inputName, selected.inputValue)
  }

  payload.set("next", "Next page")

  await moodleRequest(jar, decodeHtmlEntities(formAction[1]), {
    method: "POST",
    headers: { "Content-Type": FORM_CONTENT_TYPE },
    body: payload.toString(),
  })

  return events
}

// --- Phase 3: finalise ------------------------------------------------------

export async function finishAttempt(
  { baseUrl, sesskey, jar }: MoodleSession,
  attemptId: string,
  cmid: string
): Promise<{ grade: string; marks: string; events: SolverEvent[] }> {
  const events: SolverEvent[] = [{ status: "Finalizing and submitting quiz attempt..." }]

  // The response body is the review page.
  const { html } = await moodleRequest(
    jar,
    `${baseUrl}/mod/quiz/processattempt.php?cmid=${cmid}`,
    {
      method: "POST",
      headers: { "Content-Type": FORM_CONTENT_TYPE },
      body: new URLSearchParams({
        attempt: attemptId,
        finishattempt: "1",
        scrollpos: "0",
        sesskey,
      }).toString(),
    }
  )

  const marksMatch = html.match(MARKS_CELL)
  const gradeMatch = html.match(GRADE_CELL)
  const marks = marksMatch ? marksMatch[1].trim() : "N/A"
  const grade = gradeMatch ? cleanGrade(gradeMatch[1].trim()) : "N/A"

  events.push({ success: "Quiz submitted successfully!", grade, marks })
  return { grade, marks, events }
}
