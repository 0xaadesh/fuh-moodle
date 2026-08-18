import { errorMessage, jsonError, readCredentialedBody } from "@/lib/api"
import { sessionFromCreds } from "@/lib/moodle/auth"
import { finishAttempt } from "@/lib/moodle/attempt"
import type { SolveFinishResponse } from "@/lib/types"

// Vercel Hobby ceiling. Must be a literal: segment config is read statically.
export const maxDuration = 300

type Body = {
  cmid?: string | number
  attemptId?: string | number
}

/** Finalise the attempt and scrape the grade off the resulting review page. */
export async function POST(request: Request) {
  const parsed = await readCredentialedBody<Body>(request)
  if (!parsed.ok) return parsed.response

  const { creds, body } = parsed
  const cmid = String(body.cmid ?? "")
  const attemptId = String(body.attemptId ?? "")

  if (!cmid || !attemptId) {
    return jsonError("Both cmid and attemptId are required.", 400)
  }

  try {
    const session = await sessionFromCreds(creds)
    const result = await finishAttempt(session, attemptId, cmid)
    const payload: SolveFinishResponse = result
    return Response.json(payload)
  } catch (error) {
    return Response.json({ error: errorMessage(error), events: [] }, { status: 500 })
  }
}
