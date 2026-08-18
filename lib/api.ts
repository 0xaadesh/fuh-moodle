import { hasCredentials } from "@/lib/moodle/auth"
import type { Creds } from "@/lib/types"

export const MISSING_CREDENTIALS = "Moodle host configuration missing."

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Errors carry a JSON `{ error }` body alongside a real status code. Clients
 * read `error` regardless of status. */
export function jsonError(message: string, status = 500) {
  return Response.json({ error: message }, { status })
}

type ParsedBody<T> =
  | { ok: true; creds: Creds; body: T }
  | { ok: false; response: Response }

/**
 * Read credentials out of the POST body. They travel in the body rather than
 * the query string so they never land in request logs.
 */
export async function readCredentialedBody<T = Record<string, unknown>>(
  request: Request
): Promise<ParsedBody<T>> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { ok: false, response: jsonError("Request body must be valid JSON.", 400) }
  }

  if (!hasCredentials(body as Partial<Creds>)) {
    return { ok: false, response: jsonError(MISSING_CREDENTIALS, 400) }
  }

  return { ok: true, creds: body as Creds, body: body as T }
}
