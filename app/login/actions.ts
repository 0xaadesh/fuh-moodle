"use server"

import { redirect } from "next/navigation"

import { endSession, startSession, verifyCredentials } from "@/lib/auth"

export type LoginState = { error?: string }

/** Only relative, same-site paths are accepted, so `?next=` cannot be used to
 * bounce someone to another origin after login. */
function safeRedirectTarget(value: FormDataEntryValue | null): string {
  const target = typeof value === "string" ? value : ""
  return target.startsWith("/") && !target.startsWith("//") ? target : "/dashboard"
}

export async function login(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "")
  const password = String(formData.get("password") ?? "")

  if (!username || !password) {
    return { error: "Enter both a username and a password." }
  }

  let ok = false
  try {
    ok = await verifyCredentials(username, password)
  } catch (error) {
    // Missing ADMIN_USERNAME / ADMIN_PASSWORD. Say so plainly — this is an
    // operator error, not a wrong password.
    return { error: error instanceof Error ? error.message : "Login is unavailable." }
  }

  // One message for both wrong username and wrong password: naming which half
  // failed tells an attacker whether the username exists.
  if (!ok) return { error: "Incorrect username or password." }

  await startSession(username)
  redirect(safeRedirectTarget(formData.get("next")))
}

export async function logout(): Promise<void> {
  await endSession()
  redirect("/login")
}
