import { errorMessage, jsonError, readCredentialedBody } from "@/lib/api"
import { sessionFromCreds } from "@/lib/moodle/auth"
import {
  discoverPageCount,
  harvestAllPages,
  resolveAttempt,
} from "@/lib/moodle/attempt"
import { DEFAULT_GROQ_MODEL, solveBatch } from "@/lib/groq"
import type { SolveStartResponse, SolverEvent } from "@/lib/types"

// Vercel Hobby ceiling. Must be a literal: segment config is read statically.
export const maxDuration = 300

/**
 * The long step of the solve: resume or start an attempt, discover the page
 * count, harvest every question, and get the answer map from Groq in a single
 * batched call. Nothing is mutated on Moodle's side beyond opening the attempt.
 *
 * The client keeps the returned attemptId and answers and drives the rest.
 */
export async function POST(request: Request) {
  const parsed = await readCredentialedBody<{ cmid?: string | number }>(request)
  if (!parsed.ok) return parsed.response

  const { creds, body } = parsed
  const cmid = String(body.cmid ?? "")
  if (!cmid) return jsonError("A quiz cmid is required.", 400)
  if (!creds.groqApiKey) return jsonError("A Groq API key is required to solve.", 400)

  const events: SolverEvent[] = []

  try {
    const session = await sessionFromCreds(creds)

    const attempt = await resolveAttempt(session, cmid)
    events.push(...attempt.events)

    const totalPages = await discoverPageCount(session, attempt.attemptUrl)
    events.push({
      status: `Found ${totalPages} page(s) in this quiz. Harvesting questions...`,
    })

    const harvest = await harvestAllPages(session, attempt.attemptId, cmid, totalPages)
    events.push(...harvest.events)

    // Echo the harvested text into the log. If the model is scoring badly,
    // this is where you see whether it is reasoning over the real options or
    // over something the scraper mangled.
    for (const question of harvest.questions) {
      const choices = question.choices.map((c) => `${c.letter}) ${c.text}`).join("   ")
      events.push({ status: `Sending Q${question.qno}: ${question.question}` })
      events.push({ status: `          choices: ${choices}` })
    }

    events.push({
      status: `Sending all ${harvest.questions.length} questions to Groq AI in a single batch query...`,
    })
    events.push({ thinking: true })

    const model = creds.groqModel || DEFAULT_GROQ_MODEL
    const { answers, mode } = await solveBatch(
      creds.groqApiKey,
      harvest.questions,
      model
    )
    events.push({ status: `${model} answered using ${mode} mode.` })

    const missing = harvest.questions.filter((q) => !(String(q.qno) in answers))
    if (missing.length > 0) {
      events.push({
        status: `Note: the model omitted ${missing.length} question(s) (${missing
          .map((q) => q.qno)
          .join(", ")}); those will default to option "a".`,
      })
    }

    events.push({
      status: "Batch answers computed successfully! Submitting answers page-by-page...",
    })

    const payload: SolveStartResponse = {
      attemptId: attempt.attemptId,
      totalPages,
      questions: harvest.questions,
      answers,
      events,
    }
    return Response.json(payload)
  } catch (error) {
    return Response.json(
      { error: errorMessage(error), events },
      { status: 500 }
    )
  }
}
