"use client"

import * as React from "react"
import { useFormStatus } from "react-dom"
import { LogInIcon } from "lucide-react"

import { login, type LoginState } from "@/app/login/actions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Spinner data-icon="inline-start" /> : <LogInIcon data-icon="inline-start" />}
      {pending ? "Signing in..." : "Sign in"}
    </Button>
  )
}

export function LoginForm({
  next,
  className,
  ...props
}: React.ComponentProps<"div"> & { next?: string }) {
  const [state, formAction] = React.useActionState<LoginState, FormData>(login, {})

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>Sign in to QuizSprint</CardTitle>
          <CardDescription>
            This dashboard is private. Enter the operator credentials to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction}>
            <input type="hidden" name="next" value={next ?? "/dashboard"} />
            <FieldGroup>
              {state.error ? (
                <Alert variant="destructive">
                  <AlertTitle>Could not sign in</AlertTitle>
                  <AlertDescription>{state.error}</AlertDescription>
                </Alert>
              ) : null}

              <Field data-invalid={state.error ? true : undefined}>
                <FieldLabel htmlFor="username">Username</FieldLabel>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  aria-invalid={state.error ? true : undefined}
                  required
                />
              </Field>

              <Field data-invalid={state.error ? true : undefined}>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={state.error ? true : undefined}
                  required
                />
              </Field>

              <Field>
                <SubmitButton />
                <FieldDescription className="text-center">
                  Your Moodle login is entered separately, inside the dashboard.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
