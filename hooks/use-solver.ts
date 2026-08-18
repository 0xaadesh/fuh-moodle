"use client"

import * as React from "react"

import { solveFinish, solveStart, solveSubmitPage } from "@/lib/client-api"
import type { Choice, Creds, Quiz, SolverEvent } from "@/lib/types"

export type LogTone = "default" | "info" | "success" | "error"

export type LogEntry = {
  id: number
  time: string
  message: string
  tone: LogTone
}

export type FocusQuestion = {
  qno: number
  question: string
  choices: Choice[]
}

export type SolverState = {
  open: boolean
  running: boolean
  quizName: string
  summary: string
  log: LogEntry[]
  focus: FocusQuestion | null
  /** Letter of the choice the model picked, for highlighting the focus card. */
  selected: string | null
  thinking: boolean
  page: number
  totalPages: number
}

const INITIAL: SolverState = {
  open: false,
  running: false,
  quizName: "",
  summary: "",
  log: [],
  focus: null,
  selected: null,
  thinking: false,
  page: 0,
  totalPages: 0,
}

/** Cooldown between quizzes in a "Solve All" run, as in the original. */
const SOLVE_ALL_COOLDOWN_MS = 2000

function timestamp(): string {
  return new Date().toLocaleTimeString()
}

export function useSolver(credentials: Creds, onQuizComplete?: () => void) {
  const [state, setState] = React.useState<SolverState>(INITIAL)
  const abortRef = React.useRef<AbortController | null>(null)
  const logId = React.useRef(0)

  const append = React.useCallback((message: string, tone: LogTone = "default") => {
    logId.current += 1
    const entry: LogEntry = { id: logId.current, time: timestamp(), message, tone }
    setState((prev) => ({ ...prev, log: [...prev.log, entry] }))
  }, [])

  /**
   * The §6.3 event vocabulary, applied to the terminal. The transport changed
   * from SSE to short POST calls returning event arrays, but each event still
   * means exactly what it used to.
   */
  const applyEvent = React.useCallback(
    (event: SolverEvent) => {
      if ("status" in event) {
        append(event.status, "info")
        setState((prev) => ({ ...prev, summary: event.status }))
        return
      }
      if ("thinking" in event) {
        setState((prev) => ({ ...prev, thinking: true }))
        return
      }
      if ("question" in event) {
        setState((prev) => ({
          ...prev,
          focus: { qno: event.qno, question: event.question, choices: event.choices },
          selected: null,
        }))
        append(`Q${event.qno}: ${event.question}`)
        return
      }
      if ("answer" in event) {
        setState((prev) => ({ ...prev, selected: event.answer, thinking: false }))
        append(`Selected ${event.answer}) ${event.text}`, "success")
        return
      }
      if ("success" in event) {
        append(`${event.success} Marks: ${event.marks} — Grade: ${event.grade}`, "success")
        setState((prev) => ({ ...prev, summary: `Completed! Grade: ${event.grade}` }))
        return
      }
      append(event.error, "error")
      setState((prev) => ({ ...prev, summary: event.error }))
    },
    [append]
  )

  /**
   * Drive one quiz end to end: start (attempt + harvest + Groq), then one
   * submit call per page in order, then finish. The client is the state store —
   * attemptId and the answer map are passed between calls — so a failed page
   * can be retried without restarting the whole solve.
   */
  const solveQuiz = React.useCallback(
    async (quiz: Quiz, signal: AbortSignal) => {
      setState((prev) => ({
        ...prev,
        quizName: quiz.name,
        focus: null,
        selected: null,
        page: 0,
        totalPages: 0,
      }))

      const start = await solveStart(credentials, quiz.id, signal)
      start.events.forEach(applyEvent)
      setState((prev) => ({ ...prev, totalPages: start.totalPages, thinking: false }))

      for (let page = 0; page < start.totalPages; page++) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError")
        setState((prev) => ({ ...prev, page: page + 1 }))
        const result = await solveSubmitPage(
          credentials,
          {
            cmid: quiz.id,
            attemptId: start.attemptId,
            page,
            totalPages: start.totalPages,
            answers: start.answers,
            // Carried through so the submit pass can match the chosen option
            // by its text, not just by the letter the model replied with.
            questions: start.questions,
          },
          signal
        )
        result.events.forEach(applyEvent)
      }

      const finished = await solveFinish(
        credentials,
        { cmid: quiz.id, attemptId: start.attemptId },
        signal
      )
      finished.events.forEach(applyEvent)
    },
    [applyEvent, credentials]
  )

  const run = React.useCallback(
    async (quizzes: Quiz[]) => {
      if (quizzes.length === 0) return

      const controller = new AbortController()
      abortRef.current = controller
      logId.current = 0

      setState({
        ...INITIAL,
        open: true,
        running: true,
        quizName: quizzes[0].name,
        summary: "Starting...",
      })

      for (const [index, quiz] of quizzes.entries()) {
        if (controller.signal.aborted) break

        if (index > 0) {
          append(
            `Waiting ${SOLVE_ALL_COOLDOWN_MS / 1000} seconds before starting next quiz...`,
            "info"
          )
          await new Promise((resolve) => setTimeout(resolve, SOLVE_ALL_COOLDOWN_MS))
          if (controller.signal.aborted) break
        }

        if (quizzes.length > 1) {
          append(`--- ${quiz.name} (${index + 1}/${quizzes.length}) ---`, "info")
        }

        try {
          await solveQuiz(quiz, controller.signal)
        } catch (error) {
          if (controller.signal.aborted) break
          // A failure in one quiz is logged and the loop continues to the next.
          applyEvent({
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      abortRef.current = null
      setState((prev) => ({ ...prev, running: false, thinking: false }))
      onQuizComplete?.()
    },
    [append, applyEvent, onQuizComplete, solveQuiz]
  )

  /** Aborting mid-run leaves the attempt part-submitted; the log says so. */
  const abort = React.useCallback(() => {
    if (!abortRef.current) return
    abortRef.current.abort()
    abortRef.current = null
    append("Run cancelled. The attempt may be left partially submitted.", "error")
    setState((prev) => ({ ...prev, running: false, thinking: false }))
  }, [append])

  const setOpen = React.useCallback(
    (open: boolean) => {
      if (!open && abortRef.current) abort()
      setState((prev) => ({ ...prev, open }))
    },
    [abort]
  )

  return { state, run, abort, setOpen }
}
