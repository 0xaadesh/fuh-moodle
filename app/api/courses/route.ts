import { errorMessage, jsonError, readCredentialedBody } from "@/lib/api"
import { sessionFromCreds } from "@/lib/moodle/auth"
import { getCourses } from "@/lib/moodle/courses"

// Vercel Hobby ceiling. Must be a literal: segment config is read statically.
export const maxDuration = 300

export async function POST(request: Request) {
  const parsed = await readCredentialedBody(request)
  if (!parsed.ok) return parsed.response

  try {
    const session = await sessionFromCreds(parsed.creds)
    return Response.json({ courses: await getCourses(session) })
  } catch (error) {
    return jsonError(errorMessage(error))
  }
}
