"use client"

import * as React from "react"
import { SaveIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { DEFAULT_GROQ_MODEL, STRUCTURED_OUTPUT_MODELS } from "@/lib/groq"
import type { Creds } from "@/lib/types"

export function MoodleConfigForm({
  credentials,
  onSave,
  disabled,
}: {
  credentials: Creds
  onSave: (creds: Creds) => void
  disabled?: boolean
}) {
  const [draft, setDraft] = React.useState(credentials)

  // Adopt values loaded from localStorage after hydration.
  React.useEffect(() => {
    setDraft(credentials)
  }, [credentials])

  function update(field: keyof Creds) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      setDraft((prev) => ({ ...prev, [field]: event.target.value }))
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSave(draft)
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="moodle-url">Moodle URL</FieldLabel>
          <Input
            id="moodle-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://moodle.example.edu"
            value={draft.moodleUrl}
            onChange={update("moodleUrl")}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="moodle-username">Username</FieldLabel>
          <Input
            id="moodle-username"
            autoComplete="username"
            placeholder="s12345"
            value={draft.username}
            onChange={update("username")}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="moodle-password">Password</FieldLabel>
          <Input
            id="moodle-password"
            type="password"
            autoComplete="current-password"
            value={draft.password}
            onChange={update("password")}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="groq-key">Groq API key</FieldLabel>
          <Input
            id="groq-key"
            type="password"
            autoComplete="off"
            placeholder="gsk_..."
            value={draft.groqApiKey ?? ""}
            onChange={update("groqApiKey")}
          />
          <FieldDescription>Only needed to solve quizzes.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="groq-model">Groq model</FieldLabel>
          <Input
            id="groq-model"
            autoComplete="off"
            placeholder={DEFAULT_GROQ_MODEL}
            value={draft.groqModel ?? ""}
            onChange={update("groqModel")}
          />
          <FieldDescription>
            Must be a chat model — classifiers such as llama-prompt-guard cannot
            answer questions. Best results with{" "}
            {STRUCTURED_OUTPUT_MODELS.slice(0, 2).join(" or ")}.
          </FieldDescription>
        </Field>

        <Field>
          <Button type="submit" disabled={disabled}>
            <SaveIcon data-icon="inline-start" />
            Save & connect
          </Button>
          <FieldDescription>
            Stored in this browser only and sent with each request. Nothing is kept
            on the server.
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  )
}
