import { errorMessage, jsonError, readCredentialedBody } from "@/lib/api"
import { sessionFromCreds } from "@/lib/moodle/auth"
import { submitPage } from "@/lib/moodle/attempt"
import type {
  AnswerMap,
  HarvestedQuestion,
  SolveSubmitPageResponse,
} from "@/lib/types"

// Vercel Hobby ceiling. Must be a literal: segment config is read statically.
export const maxDuration = 300

type Body = {
  cmid?: string | number
  attemptId?: string | number
  page?: number
  totalPages?: number
  answers?: AnswerMap
  /** The harvest-pass questions, so the chosen option can be matched by text. */
  questions?: HarvestedQuestion[]
}

/**
 * Submit one page of answers. Called once per page, strictly in order — the
 * client retries a single failed page rather than restarting the whole solve.
 */
export async function POST(request: Request) {
  const parsed = await readCredentialedBody<Body>(request)
  if (!parsed.ok) return parsed.response

  const { creds, body } = parsed
  const cmid = String(body.cmid ?? "")
  const attemptId = String(body.attemptId ?? "")
  const page = Number(body.page ?? 0)
  const totalPages = Number(body.totalPages ?? 1)

  if (!cmid || !attemptId) {
    return jsonError("Both cmid and attemptId are required.", 400)
  }
  if (!Number.isInteger(page) || page < 0 || page >= totalPages) {
    return jsonError(`Page ${page} is out of range for ${totalPages} page(s).`, 400)
  }

  try {
    const session = await sessionFromCreds(creds)
    const events = await submitPage(
      session,
      attemptId,
      cmid,
      page,
      totalPages,
      body.answers ?? {},
      body.questions ?? []
    )
    const payload: SolveSubmitPageResponse = { page, events }
    return Response.json(payload)
  } catch (error) {
    return Response.json({ error: errorMessage(error), events: [] }, { status: 500 })
  }
}
