import { redirect } from "next/navigation"

import { currentUser } from "@/lib/auth"

/**
 * The real lock on the dashboard. `proxy.ts` gates the route earlier for a
 * faster redirect, but authorisation is re-checked here so the page cannot
 * render for an unauthenticated request even if the proxy is bypassed or
 * misconfigured.
 */
export default async function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  if (!(await currentUser())) redirect("/login?next=/dashboard")
  return children
}
