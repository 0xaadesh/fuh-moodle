/** Credentials are bring-your-own and client-held. They transit the server on
 * every request but are never persisted there. See MIGRATION.md §2.2 / §7.1. */
export type Creds = {
  moodleUrl: string
  username: string
  password: string
  /** Only the solve routes need it. */
  groqApiKey?: string
  /** Defaults to DEFAULT_GROQ_MODEL. */
  groqModel?: string
}

/** Moodle's own timeline classification. Resolved from the enrolment window
 * when the list is fetched, so nothing reads the clock while rendering. */
export const COURSE_TIMELINES = ["In progress", "Upcoming", "Past"] as const

export type CourseTimeline = (typeof COURSE_TIMELINES)[number]

export type Course = {
  id: number
  fullname: string
  shortname: string
  viewurl?: string
  /** Category name. Optional: a Moodle that does not return it just leaves the
   * column and its filter empty. */
  category?: string
  timeline: CourseTimeline
}

export type QuizStatus = {
  status: string
  marks: string | null
  grade: string | null
}

/** `id` is a Moodle *cmid* (course-module id), not a quiz id. Every downstream
 * URL — view.php?id=, attempt.php?cmid=, processattempt.php?cmid= — uses it. */
export type Quiz = {
  id: string
  name: string
  url: string
  status: QuizStatus
}

export type Choice = {
  letter: string
  text: string
}

export type HarvestedQuestion = {
  qno: number
  question: string
  choices: Choice[]
}

/** Answer map returned by Groq: string question number -> lowercase letter. */
export type AnswerMap = Record<string, string>

/**
 * The event vocabulary from MIGRATION.md §6.3, preserved verbatim. The
 * transport changed (SSE -> JSON arrays returned by short POST calls) but the
 * terminal UI still consumes exactly these shapes.
 */
export type SolverEvent =
  | { status: string }
  | { thinking: true }
  | { question: string; qno: number; choices: Choice[] }
  | { answer: string; text: string }
  | { success: string; grade: string; marks: string }
  | { error: string }

export type SolveStartResponse = {
  attemptId: string
  totalPages: number
  questions: HarvestedQuestion[]
  answers: AnswerMap
  events: SolverEvent[]
}

export type SolveSubmitPageResponse = {
  page: number
  events: SolverEvent[]
}

export type SolveFinishResponse = {
  grade: string
  marks: string
  events: SolverEvent[]
}
