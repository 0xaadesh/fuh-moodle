import { errorMessage, jsonError, readCredentialedBody } from "@/lib/api"
import { sessionFromCreds } from "@/lib/moodle/auth"
import { getQuizzes } from "@/lib/moodle/quizzes"

// Vercel Hobby ceiling. Must be a literal: segment config is read statically.
export const maxDuration = 300

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/courses/[courseId]/quizzes">
) {
  const parsed = await readCredentialedBody(request)
  if (!parsed.ok) return parsed.response

  const { courseId } = await ctx.params

  try {
    const session = await sessionFromCreds(parsed.creds)
    return Response.json({ quizzes: await getQuizzes(session, courseId) })
  } catch (error) {
    return jsonError(errorMessage(error))
  }
}
