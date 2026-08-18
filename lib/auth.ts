import { cookies } from "next/headers"

import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSessionToken,
  timingSafeEqual,
  verifySessionToken,
} from "@/lib/session"

/**
 * A single operator account, configured entirely through the environment.
 * This gate is separate from the Moodle credentials — those still belong to
 * the browser and are never stored server-side.
 */
export type AuthConfig = {
  username: string
  password: string
  secret: string
}

/**
 * Throws when the app is not configured. Failing closed is deliberate: a
 * missing password must never mean "let everyone in".
 */
export function authConfig(): AuthConfig {
  const username = process.env.ADMIN_USERNAME
  const password = process.env.ADMIN_PASSWORD

  if (!username || !password) {
    throw new Error(
      "ADMIN_USERNAME and ADMIN_PASSWORD must be set for the dashboard to be reachable."
    )
  }

  // Deriving the signing key from the password is a reasonable default: it
  // never leaves the server, and changing the password invalidates every
  // existing session. Set AUTH_SECRET to decouple the two.
  const secret = process.env.AUTH_SECRET || `fuh-moodle:${username}:${password}`

  return { username, password, secret }
}

/** Env may be unset at build time; callers that only need the secret for
 * verification should tolerate that rather than crash the render. */
export function authConfigOrNull(): AuthConfig | null {
  try {
    return authConfig()
  } catch {
    return null
  }
}

export async function verifyCredentials(
  username: string,
  password: string
): Promise<boolean> {
  const config = authConfig()
  // Both compared every time — no early return, so a wrong username costs the
  // same as a wrong password.
  const [userOk, passOk] = await Promise.all([
    timingSafeEqual(username, config.username),
    timingSafeEqual(password, config.password),
  ])
  return userOk && passOk
}

export async function startSession(username: string): Promise<void> {
  const { secret } = authConfig()
  const cookieStore = await cookies()

  cookieStore.set(SESSION_COOKIE, await createSessionToken(username, secret), {
    httpOnly: true, // unreadable from JavaScript
    sameSite: "lax", // survives top-level navigation, blocks cross-site POSTs
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  })
}

export async function endSession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
}

/** The authenticated username, or null. Verifies the signature — never trust
 * the mere presence of the cookie. */
export async function currentUser(): Promise<string | null> {
  // Read the cookie first, unconditionally. Touching cookies() is what opts a
  // route out of static prerendering — bailing out before this line would let
  // a guarded page be prerendered at build time and never re-checked.
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value

  const config = authConfigOrNull()
  if (!config) return null

  return verifySessionToken(token, config.secret)
}
