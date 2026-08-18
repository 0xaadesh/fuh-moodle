"use client"

import * as React from "react"

import type { Creds } from "@/lib/types"

/**
 * Credentials are bring-your-own and live only in this browser. The server
 * stores nothing: every request carries them in its POST body and the route
 * handler forgets them when it returns.
 *
 * Key names match the original app so an existing localStorage carries over.
 */
const KEYS = {
  moodleUrl: "moodle_url",
  username: "username",
  password: "password",
  groqApiKey: "groq_api_key",
  groqModel: "groq_model",
} as const

export const DEFAULT_MOODLE_URL = "http://localhost:8080"

export const EMPTY_CREDENTIALS: Creds = {
  moodleUrl: DEFAULT_MOODLE_URL,
  username: "",
  password: "",
  groqApiKey: "",
  groqModel: "",
}

function read(): Creds {
  return {
    moodleUrl: localStorage.getItem(KEYS.moodleUrl) || DEFAULT_MOODLE_URL,
    username: localStorage.getItem(KEYS.username) || "",
    password: localStorage.getItem(KEYS.password) || "",
    groqApiKey: localStorage.getItem(KEYS.groqApiKey) || "",
    groqModel: localStorage.getItem(KEYS.groqModel) || "",
  }
}

export function isConfigured(creds: Creds | null): creds is Creds {
  return Boolean(creds?.moodleUrl && creds.username && creds.password)
}

export function useCredentials() {
  const [credentials, setCredentials] = React.useState<Creds>(EMPTY_CREDENTIALS)
  // localStorage is not available during the server render, so nothing that
  // depends on credentials may run until this flips.
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    setCredentials(read())
    setLoaded(true)
  }, [])

  const save = React.useCallback((next: Creds) => {
    localStorage.setItem(KEYS.moodleUrl, next.moodleUrl)
    localStorage.setItem(KEYS.username, next.username)
    localStorage.setItem(KEYS.password, next.password)
    localStorage.setItem(KEYS.groqApiKey, next.groqApiKey ?? "")
    localStorage.setItem(KEYS.groqModel, next.groqModel ?? "")
    setCredentials(next)
  }, [])

  return { credentials, loaded, save }
}
