/**
 * Signed session tokens, built on Web Crypto so the same code runs in the
 * Node runtime (route handlers, server components) and in the proxy.
 *
 * The token is `base64url(payload).base64url(hmac)`. It is signed, not
 * encrypted — it carries no secret, only the username and an expiry, and the
 * signature is what makes it unforgeable.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const SESSION_COOKIE = "fuh_session"

/** Eight hours. Long enough for a sitting, short enough that a forgotten
 * session on a shared machine expires on its own. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000

type SessionPayload = {
  /** username */
  u: string
  /** expiry, epoch ms */
  exp: number
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Returns an ArrayBuffer rather than a Uint8Array: Web Crypto's BufferSource
 * will not accept a view whose backing buffer might be shared. */
function fromBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  )
}

export async function createSessionToken(
  username: string,
  secret: string
): Promise<string> {
  const payload: SessionPayload = { u: username, exp: Date.now() + SESSION_TTL_MS }
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)))
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    encoder.encode(encoded)
  )
  return `${encoded}.${toBase64Url(new Uint8Array(signature))}`
}

/** Returns the username, or null if the token is malformed, unsigned by us,
 * or expired. */
export async function verifySessionToken(
  token: string | undefined,
  secret: string
): Promise<string | null> {
  if (!token) return null

  const [encoded, signature] = token.split(".")
  if (!encoded || !signature) return null

  try {
    // subtle.verify is constant-time, so this does not leak the signature.
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(secret),
      fromBase64Url(signature),
      encoder.encode(encoded)
    )
    if (!valid) return null

    const payload = JSON.parse(decoder.decode(fromBase64Url(encoded))) as SessionPayload
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null
    return typeof payload.u === "string" ? payload.u : null
  } catch {
    return null
  }
}

/**
 * Constant-time comparison. Both sides are hashed first so the comparison
 * always runs over 32 bytes and the loop cannot leak the expected length.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ])
  const x = new Uint8Array(left)
  const y = new Uint8Array(right)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}
