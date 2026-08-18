import { z } from "zod"

import type { AnswerMap, HarvestedQuestion } from "@/lib/types"

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

/** Supports structured outputs, so the answer sheet comes back schema-valid on
 * the first attempt without falling through the ladder below. */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"

/** Models known to support `response_format: json_schema` on Groq. Shown in
 * the UI as a hint; the request ladder below does not depend on this list. */
export const STRUCTURED_OUTPUT_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "moonshotai/kimi-k2-instruct",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
]

/**
 * The whole quiz goes out in one request — deliberately. One call per question
 * would trip Groq's rate limits on a 30-question quiz.
 *
 * Long prompts are what produce HTTP 413, so question and choice text are
 * capped. These bounds are far above any real quiz question.
 */
const MAX_QUESTION_CHARS = 1200
const MAX_CHOICE_CHARS = 400

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}...`
}

/**
 * An array of {qno, letter} rather than a map keyed by question number:
 * strict JSON-schema modes cannot express dynamic keys, and an array is what
 * structured outputs handles reliably.
 */
const AnswerSheet = z.object({
  answers: z.array(
    z.object({
      qno: z.number().int(),
      letter: z.string(),
    })
  ),
})

/** Groq rejects unknown top-level keys on the schema it is handed. */
function wireSchema(): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(AnswerSheet) as Record<string, unknown>
  void $schema
  return rest
}

function buildPrompt(questions: HarvestedQuestion[]): string {
  const block = questions
    .map((q) => {
      const choices = q.choices
        .map((c) => `${c.letter}) ${truncate(c.text, MAX_CHOICE_CHARS)}`)
        .join("\n")
      return `Question ${q.qno}:\n${truncate(q.question, MAX_QUESTION_CHARS)}\n\nChoices:\n${choices}`
    })
    .join("\n\n---\n\n")

  return (
    `Solve the following multiple-choice questions:\n\n` +
    `${block}\n\n` +
    `Identify the correct option letter for each question. Answer every question.\n` +
    `Return a single JSON object of the form ` +
    `{"answers":[{"qno":1,"letter":"a"},{"qno":2,"letter":"c"}]}, ` +
    `where "qno" is the question number and "letter" is the correct option letter.\n\n` +
    `Do not write explanations, introductions, markdown fences, or any text other ` +
    `than the valid JSON object. Output ONLY the raw JSON object.`
  )
}

/**
 * Reasoning models emit <think> blocks and many models wrap JSON in fences.
 * Neither is valid JSON, so strip both and take the outermost object.
 */
function extractJson(content: string): string {
  const withoutThinking = content.replace(/<think>[\s\S]*?<\/think>/gi, "")
  const withoutFences = withoutThinking.replace(/```(?:json)?/gi, "")
  const start = withoutFences.indexOf("{")
  const end = withoutFences.lastIndexOf("}")
  if (start === -1 || end <= start) return withoutFences.trim()
  return withoutFences.slice(start, end + 1)
}

function toAnswerMap(raw: unknown): AnswerMap {
  const answers: AnswerMap = {}

  const structured = AnswerSheet.safeParse(raw)
  if (structured.success) {
    for (const { qno, letter } of structured.data.answers) {
      answers[String(qno)] = String(letter).trim().toLowerCase()
    }
    return answers
  }

  // Fallback shape: the flat {"1": "a", "2": "c"} map a model may produce when
  // it is not being held to the schema.
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [qno, letter] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof letter === "string" || typeof letter === "number") {
        answers[String(qno)] = String(letter).trim().toLowerCase()
      }
    }
  }

  if (Object.keys(answers).length === 0) {
    throw new Error("the model returned no usable answers")
  }
  return answers
}

type ResponseFormat = Record<string, unknown> | undefined

async function callGroq(
  apiKey: string,
  model: string,
  prompt: string,
  responseFormat: ResponseFormat
): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }),
  })

  if (!res.ok) {
    const detail = await res.text()
    if (res.status === 413) {
      const kb = (prompt.length / 1024).toFixed(1)
      throw new Error(
        `HTTP 413: the ${kb} KB prompt for this quiz exceeds what "${model}" accepts in one request. ` +
          `Try a model with a larger request limit, such as llama-3.3-70b-versatile or openai/gpt-oss-120b.`
      )
    }
    throw new Error(`HTTP ${res.status}: ${detail.slice(0, 300)}`)
  }

  const payload = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = payload.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error("the model returned an empty completion")
  return content
}

/**
 * One request for the whole quiz, with a fallback ladder for models that do
 * not support the stronger JSON modes:
 *
 *   1. `json_schema` — structured outputs; the model cannot return a bad shape.
 *   2. `json_object` — older JSON mode.
 *   3. no response_format — parse the JSON out of plain text.
 *
 * Only a failure advances the ladder, so a supported model still costs exactly
 * one call.
 */
export async function solveBatch(
  apiKey: string,
  questions: HarvestedQuestion[],
  model: string = DEFAULT_GROQ_MODEL
): Promise<{ answers: AnswerMap; mode: string }> {
  const prompt = buildPrompt(questions)

  const attempts: Array<{ mode: string; format: ResponseFormat }> = [
    {
      mode: "json_schema",
      format: {
        type: "json_schema",
        json_schema: { name: "quiz_answers", schema: wireSchema() },
      },
    },
    { mode: "json_object", format: { type: "json_object" } },
    { mode: "text", format: undefined },
  ]

  const failures: string[] = []

  for (const attempt of attempts) {
    try {
      const content = await callGroq(apiKey, model, prompt, attempt.format)
      return { answers: toAnswerMap(JSON.parse(extractJson(content))), mode: attempt.mode }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // A payload too large for the model will not get smaller on retry.
      if (message.startsWith("HTTP 413")) {
        throw new Error(`Batch Groq API call failed: ${message}`)
      }
      failures.push(`${attempt.mode}: ${message}`)
    }
  }

  throw new Error(
    `Batch Groq API call failed for model "${model}". Every JSON mode was rejected — ` +
      `check that this is a chat model (classifiers and guard models cannot answer questions). ` +
      `Details: ${failures.join(" | ")}`
  )
}
