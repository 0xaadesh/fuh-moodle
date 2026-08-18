import {
  createJar,
  FORM_CONTENT_TYPE,
  moodleRequest,
  normalizeBaseUrl,
  type Jar,
} from "@/lib/moodle/client"
import { LOGIN_TOKEN, SESSKEY } from "@/lib/moodle/parse"
import type { Creds } from "@/lib/types"

export type MoodleSession = {
  baseUrl: string
  sesskey: string
  jar: Jar
}

/**
 * Drive Moodle's normal HTML login form and keep the resulting session.
 *
 * There is no Web Services token involved: three HTTP steps produce a cookie
 * jar (which authenticates requests) and a sesskey (which authorises AJAX and
 * submit actions).
 *
 * Deliberately not cached. A module-level cache is nondeterministic on
 * serverless — warm instances would hit it, cold ones would not — so every
 * request re-logs in, at a cost of ~2 roundtrips.
 */
export async function loginSession(
  moodleUrl: string,
  username: string,
  password: string
): Promise<MoodleSession> {
  const baseUrl = normalizeBaseUrl(moodleUrl)
  const loginUrl = `${baseUrl}/login/index.php`
  const jar = createJar()

  // 1. GET the login page for the anti-CSRF token. The cookie set here must be
  //    replayed in step 2 or the token will not validate.
  const { html } = await moodleRequest(jar, loginUrl)
  const tokenMatch = html.match(LOGIN_TOKEN)
  if (!tokenMatch) {
    throw new Error("Login token not found on the login page.")
  }

  // 2. POST the credentials. Moodle redirects through to the dashboard and the
  //    jar picks up the authenticated MoodleSession cookie along the way.
  const { html: landingHtml } = await moodleRequest(jar, loginUrl, {
    method: "POST",
    headers: { "Content-Type": FORM_CONTENT_TYPE },
    body: new URLSearchParams({
      username,
      password,
      logintoken: tokenMatch[1],
    }).toString(),
  })

  // 3. Extract the sesskey from the JS config blob on any authenticated page.
  let sesskeyMatch = landingHtml.match(SESSKEY)
  if (!sesskeyMatch) {
    const { html: myHtml } = await moodleRequest(jar, `${baseUrl}/my/`)
    sesskeyMatch = myHtml.match(SESSKEY)
  }
  if (!sesskeyMatch) {
    // A failed login re-renders the login form rather than returning an error
    // status, so a missing sesskey is how wrong credentials manifest.
    throw new Error("Failed to locate sesskey after login. Check your credentials.")
  }

  return { baseUrl, sesskey: sesskeyMatch[1], jar }
}

export function hasCredentials(creds: Partial<Creds> | null): creds is Creds {
  return Boolean(creds?.moodleUrl && creds?.username && creds?.password)
}

export async function sessionFromCreds(creds: Creds): Promise<MoodleSession> {
  return loginSession(creds.moodleUrl, creds.username, creds.password)
}
