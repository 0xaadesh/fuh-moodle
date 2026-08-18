import { errorMessage, readCredentialedBody } from "@/lib/api"
import { sessionFromCreds } from "@/lib/moodle/auth"

// Vercel Hobby ceiling. Must be a literal: segment config is read statically.
export const maxDuration = 300

/** Verify the credentials by performing a full login handshake. */
export async function POST(request: Request) {
  const parsed = await readCredentialedBody(request)
  if (!parsed.ok) {
    return Response.json({ authenticated: false })
  }

  const { creds } = parsed
  try {
    await sessionFromCreds(creds)
    return Response.json({
      authenticated: true,
      username: creds.username,
      moodleUrl: creds.moodleUrl,
    })
  } catch (error) {
    return Response.json({
      authenticated: false,
      username: "",
      moodleUrl: "",
      error: errorMessage(error),
    })
  }
}
