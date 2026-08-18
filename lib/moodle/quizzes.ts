import type { MoodleSession } from "@/lib/moodle/auth"
import { mapWithConcurrency, moodleRequest } from "@/lib/moodle/client"
import {
  ATTEMPT_BLOCK_DELIMITER,
  ATTEMPT_NUMBER,
  cleanGrade,
  GRADE_CELL,
  MARKS_CELL,
  quizLinks,
  STATUS_CELL,
} from "@/lib/moodle/parse"
import type { Quiz, QuizStatus } from "@/lib/types"

/** Moodle is happier with a handful of parallel requests than with fifteen. */
const STATUS_CONCURRENCY = 6

/**
 * Scrape the latest attempt's status off a quiz's view page.
 *
 * Never throws: one broken quiz must not take down the whole course listing,
 * so failures come back as a status string instead.
 */
export async function getQuizStatus(
  { baseUrl, jar }: MoodleSession,
  cmid: string
): Promise<QuizStatus> {
  try {
    const { html } = await moodleRequest(jar, `${baseUrl}/mod/quiz/view.php?id=${cmid}`)

    // Boost renders attempts as a list. Themes that do not still tend to work
    // via the whole-page fallback, because the cell regexes are anchored on
    // the <th> labels.
    let blocks = html.split(ATTEMPT_BLOCK_DELIMITER)
    if (blocks.length <= 1) blocks = [html]

    const attempts = blocks.flatMap((block) => {
      const numberMatch = block.match(ATTEMPT_NUMBER)
      if (!numberMatch) return []

      const statusMatch = block.match(STATUS_CELL)
      const marksMatch = block.match(MARKS_CELL)
      const gradeMatch = block.match(GRADE_CELL)

      return [
        {
          number: Number(numberMatch[1]),
          status: statusMatch ? statusMatch[1].trim() : "Finished",
          marks: marksMatch ? marksMatch[1].trim() : null,
          grade: gradeMatch ? cleanGrade(gradeMatch[1].trim()) : null,
        },
      ]
    })

    if (attempts.length > 0) {
      attempts.sort((a, b) => a.number - b.number)
      const latest = attempts[attempts.length - 1]
      return { status: latest.status, marks: latest.marks, grade: latest.grade }
    }

    // No attempt blocks — fall back to sniffing the call-to-action button.
    if (html.includes("Attempt quiz")) {
      return { status: "Not attempted", marks: null, grade: null }
    }
    if (html.includes("Continue your attempt")) {
      return { status: "In progress", marks: null, grade: null }
    }
    return { status: "Not attempted", marks: null, grade: null }
  } catch (error) {
    return {
      status: `Error (${error instanceof Error ? error.message : String(error)})`,
      marks: null,
      grade: null,
    }
  }
}

/**
 * List a course's quizzes by scraping its page, then resolve each quiz's
 * status. The status lookups run concurrently — done serially this was the
 * slowest endpoint in the app by a wide margin.
 */
export async function getQuizzes(
  session: MoodleSession,
  courseId: string | number
): Promise<Quiz[]> {
  const { html } = await moodleRequest(
    session.jar,
    `${session.baseUrl}/course/view.php?id=${courseId}`
  )

  const seen = new Set<string>()
  const found: Array<{ id: string; name: string; url: string }> = []
  for (const match of html.matchAll(quizLinks())) {
    const [, url, cmid, name] = match
    if (seen.has(cmid)) continue
    seen.add(cmid)
    found.push({ id: cmid, name: name.trim(), url })
  }

  const statuses = await mapWithConcurrency(found, STATUS_CONCURRENCY, (quiz) =>
    getQuizStatus(session, quiz.id)
  )

  return found.map((quiz, index) => ({ ...quiz, status: statuses[index] }))
}
