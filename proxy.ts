import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { SESSION_COOKIE, verifySessionToken } from "@/lib/session"

/**
 * Gate for everything behind the login: the dashboard and every Moodle-facing
 * API route.
 *
 * The signature is verified here rather than merely checking that a cookie
 * exists, so a hand-written cookie does not get past this point. Web Crypto is
 * available in this runtime, and `lib/session` deliberately avoids node:crypto
 * so the same code works in both places.
 *
 * `app/dashboard/layout.tsx` re-checks independently — this is a gate, not the
 * only lock on the door.
 */
export async function proxy(request: NextRequest) {
  const secret =
    process.env.AUTH_SECRET ||
    `fuh-moodle:${process.env.ADMIN_USERNAME}:${process.env.ADMIN_PASSWORD}`

  const token = request.cookies.get(SESSION_COOKIE)?.value
  const username = await verifySessionToken(token, secret)
  if (username) return NextResponse.next()

  // API callers get a status they can act on; humans get sent to the form.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 })
  }

  const loginUrl = new URL("/login", request.url)
  loginUrl.searchParams.set("next", request.nextUrl.pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
}
