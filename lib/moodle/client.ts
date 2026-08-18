/**
 * Cookie jar + fetch wrapper. Node's fetch has no cookie jar and will not
 * expose Set-Cookie from intermediate redirect hops, so redirects are followed
 * manually: it lets us absorb cookies at every hop *and* observe the final URL
 * (needed to read the attempt id out of the startattempt.php redirect).
 */

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"

export const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded"

export type Jar = Map<string, string>

export function createJar(): Jar {
  return new Map()
}

function absorb(jar: Jar, res: Response) {
  // getSetCookie() returns ALL Set-Cookie headers. headers.get('set-cookie')
  // collapses them into one string and corrupts the jar.
  for (const cookie of res.headers.getSetCookie()) {
    const [pair] = cookie.split(";")
    const idx = pair.indexOf("=")
    if (idx > 0) {
      jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
    }
  }
}

function cookieHeader(jar: Jar): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ")
}

export type MoodleResponse = {
  html: string
  finalUrl: string
  status: number
}

export type MoodleRequestInit = {
  method?: string
  body?: string
  headers?: Record<string, string>
}

const MAX_REDIRECTS = 10

/** Perform a request against Moodle, replaying and absorbing cookies across
 * every redirect hop. Throws on a non-2xx terminal response, mirroring
 * urllib's HTTPError behaviour. */
export async function moodleRequest(
  jar: Jar,
  url: string,
  init: MoodleRequestInit = {}
): Promise<MoodleResponse> {
  let current = url
  let method = init.method ?? (init.body !== undefined ? "POST" : "GET")
  let body = init.body
  let headers = { ...init.headers }

  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    const res = await fetch(current, {
      method,
      body,
      redirect: "manual",
      cache: "no-store",
      headers: {
        "User-Agent": USER_AGENT,
        ...(jar.size ? { Cookie: cookieHeader(jar) } : {}),
        ...headers,
      },
    })

    absorb(jar, res)

    const location = res.headers.get("location")
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString()
      // Redirects downgrade POST to GET; the body and its Content-Type go too.
      method = "GET"
      body = undefined
      headers = {}
      continue
    }

    const html = await res.text()
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${current}`)
    }
    return { html, finalUrl: current, status: res.status }
  }

  throw new Error("Too many redirects")
}

/** Trailing slashes break every `${base}/path` template downstream. */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "")
}

/** Bounded-concurrency map. Keeps us from hammering the Moodle box while
 * still turning N sequential roundtrips into N/limit. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  })

  await Promise.all(workers)
  return results
}
