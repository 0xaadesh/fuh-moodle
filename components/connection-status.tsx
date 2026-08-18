"use client"

import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"

export type ConnectionState = "idle" | "checking" | "connected" | "disconnected" | "error"

const LABELS: Record<ConnectionState, string> = {
  idle: "Not configured",
  checking: "Connecting",
  connected: "Connected",
  disconnected: "Disconnected",
  error: "Auth Error",
}

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  if (state === "checking") {
    return (
      <Badge variant="outline">
        <Spinner />
        {LABELS.checking}
      </Badge>
    )
  }

  if (state === "connected") {
    return <Badge>{LABELS.connected}</Badge>
  }

  if (state === "error") {
    return <Badge variant="destructive">{LABELS.error}</Badge>
  }

  return <Badge variant="outline">{LABELS[state]}</Badge>
}
