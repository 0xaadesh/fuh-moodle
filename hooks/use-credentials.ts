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

/**
 * localStorage is an external store, so it is subscribed to rather than copied
 * into state after mount. The snapshot is cached because `useSyncExternalStore`
 * compares it by identity and a fresh `read()` would loop forever.
 */
const listeners = new Set<() => void>()
let snapshot: Creds | null = null

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): Creds {
  snapshot ??= read()
  return snapshot
}

/** The server has no localStorage, and neither does the hydrating render. */
function getServerSnapshot(): Creds {
  return EMPTY_CREDENTIALS
}

const onClient = () => true
const onServer = () => false

export function useCredentials() {
  const credentials = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  )
  // Flips once hydration has run, which is the point at which `credentials`
  // reflects localStorage rather than the placeholder above.
  const loaded = React.useSyncExternalStore(subscribe, onClient, onServer)

  const save = React.useCallback((next: Creds) => {
    localStorage.setItem(KEYS.moodleUrl, next.moodleUrl)
    localStorage.setItem(KEYS.username, next.username)
    localStorage.setItem(KEYS.password, next.password)
    localStorage.setItem(KEYS.groqApiKey, next.groqApiKey ?? "")
    localStorage.setItem(KEYS.groqModel, next.groqModel ?? "")
    snapshot = next
    for (const listener of listeners) listener()
  }, [])

  return { credentials, loaded, save }
}
