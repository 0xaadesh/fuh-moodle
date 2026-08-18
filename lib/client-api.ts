import type {
  Course,
  Creds,
  HarvestedQuestion,
  Quiz,
  SolveFinishResponse,
  SolveStartResponse,
  SolveSubmitPageResponse,
} from "@/lib/types"

/**
 * Every call is a POST so credentials travel in the body. The original app put
 * them in the query string for the EventSource stream, which wrote the Moodle
 * password and Groq key into request logs.
 */
async function post<T>(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })

  let payload: unknown
  try {
    payload = await res.json()
  } catch {
    throw new Error(`${res.status} ${res.statusText}`)
  }

  // Route handlers attach `error` on every failure path, whatever the status.
  const error = (payload as { error?: string } | null)?.error
  if (error) throw new Error(error)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

  return payload as T
}

export type StatusResponse = {
  authenticated: boolean
  username?: string
  moodleUrl?: string
  error?: string
}

export async function fetchStatus(
  creds: Creds,
  signal?: AbortSignal
): Promise<StatusResponse> {
  // Unlike the others, an auth failure here is the answer, not an exception.
  const res = await fetch("/api/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(creds),
    signal,
  })
  return (await res.json()) as StatusResponse
}

export async function fetchCourses(
  creds: Creds,
  signal?: AbortSignal
): Promise<Course[]> {
  const { courses } = await post<{ courses: Course[] }>("/api/courses", creds, signal)
  return courses
}

export async function fetchQuizzes(
  creds: Creds,
  courseId: number,
  signal?: AbortSignal
): Promise<Quiz[]> {
  const { quizzes } = await post<{ quizzes: Quiz[] }>(
    `/api/courses/${courseId}/quizzes`,
    creds,
    signal
  )
  return quizzes
}

export function solveStart(
  creds: Creds,
  cmid: string,
  signal?: AbortSignal
): Promise<SolveStartResponse> {
  return post<SolveStartResponse>("/api/solve/start", { ...creds, cmid }, signal)
}

export function solveSubmitPage(
  creds: Creds,
  args: {
    cmid: string
    attemptId: string
    page: number
    totalPages: number
    answers: Record<string, string>
    questions: HarvestedQuestion[]
  },
  signal?: AbortSignal
): Promise<SolveSubmitPageResponse> {
  return post<SolveSubmitPageResponse>(
    "/api/solve/submit-page",
    { ...creds, ...args },
    signal
  )
}

export function solveFinish(
  creds: Creds,
  args: { cmid: string; attemptId: string },
  signal?: AbortSignal
): Promise<SolveFinishResponse> {
  return post<SolveFinishResponse>("/api/solve/finish", { ...creds, ...args }, signal)
}

/** Case-insensitive substring match, matching the original status vocabulary. */
export function statusTone(status: string): "in-progress" | "finished" | "not-attempted" {
  const value = status.toLowerCase()
  if (value.includes("progress")) return "in-progress"
  if (value.includes("finished")) return "finished"
  return "not-attempted"
}

/** A finished quiz is excluded from "Solve All" and its Solve button is
 * replaced by a disabled one. */
export function isFinished(quiz: Quiz): boolean {
  return quiz.status.status.trim().toLowerCase() === "finished"
}
