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
 * Answers are keyed by an opaque string id, never by a number.
 *
 * Moodle question text very often begins with its own numbering ("19. What is
 * the main goal of..."). When the prompt also labelled the question with a
 * number, models resolved the ambiguity in favour of the number inside the
 * text — silently mapping every answer onto the wrong question. An id like
 * "q7" cannot collide with question content.
 */
const AnswerSheet = z.object({
  answers: z.array(
    z.object({
      id: z.string(),
      letter: z.string(),
    })
  ),
})

/** Ties the opaque prompt id back to the Moodle question number. */
type PromptItem = {
  id: string
  question: HarvestedQuestion
}

function promptItems(questions: HarvestedQuestion[]): PromptItem[] {
  return questions.map((question, index) => ({ id: `q${index + 1}`, question }))
}

/** Groq rejects unknown top-level keys on the schema it is handed. */
function wireSchema(): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(AnswerSheet) as Record<string, unknown>
  void $schema
  return rest
}

function buildPrompt(items: PromptItem[]): string {
  const block = items
    .map(({ id, question }) => {
      const choices = question.choices
        .map((c) => `${c.letter}) ${truncate(c.text, MAX_CHOICE_CHARS)}`)
        .join("\n")
      return (
        `[id: ${id}]\n` +
        `${truncate(question.question, MAX_QUESTION_CHARS)}\n\n` +
        `Choices:\n${choices}`
      )
    })
    .join("\n\n---\n\n")

  return (
    `Solve the following multiple-choice questions:\n\n` +
    `${block}\n\n` +
    `Identify the correct option letter for each question. Answer every question.\n` +
    `Return a single JSON object of the form ` +
    `{"answers":[{"id":"q1","letter":"a"},{"id":"q2","letter":"c"}]}.\n\n` +
    `IMPORTANT: "id" must be copied exactly from the [id: ...] line above each ` +
    `question. Some questions begin with their own numbering, such as ` +
    `"19. What is...". That number is part of the question text and is NOT the ` +
    `id — never use it. Only the value inside [id: ...] identifies a question.\n\n` +
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

type MappedAnswers = {
  answers: AnswerMap
  warnings: string[]
}

/**
 * Map the model's reply back onto Moodle question numbers.
 *
 * Every id is checked against the ids we actually sent. An answer keyed by
 * something we never issued is dropped and reported rather than being trusted
 * — that silent mis-key is exactly what made a run of correct answers land on
 * the wrong questions.
 */
function toAnswerMap(raw: unknown, items: PromptItem[]): MappedAnswers {
  const byId = new Map(items.map((item) => [item.id, item.question.qno]))
  const answers: AnswerMap = {}
  const warnings: string[] = []
  const unknownIds: string[] = []

  const pairs: Array<{ id: string; letter: string }> = []

  const structured = AnswerSheet.safeParse(raw)
  if (structured.success) {
    pairs.push(...structured.data.answers)
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    // Fallback shape: a flat {"q1": "a"} map, from a model not held to the schema.
    for (const [id, letter] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof letter === "string" || typeof letter === "number") {
        pairs.push({ id, letter: String(letter) })
      }
    }
  }

  for (const { id, letter } of pairs) {
    const qno = byId.get(String(id).trim())
    if (qno === undefined) {
      unknownIds.push(String(id))
      continue
    }
    answers[String(qno)] = String(letter).trim().toLowerCase()
  }

  // Nothing matched, but the model returned one answer per question in order.
  // Positional recovery is better than discarding a complete set of answers.
  if (Object.keys(answers).length === 0 && pairs.length === items.length) {
    warnings.push(
      `The model ignored the question ids (returned ${unknownIds
        .slice(0, 3)
        .join(", ")}...). Falling back to answer order, which assumes it replied in sequence.`
    )
    pairs.forEach(({ letter }, index) => {
      answers[String(items[index].question.qno)] = String(letter).trim().toLowerCase()
    })
  } else if (unknownIds.length > 0) {
    warnings.push(
      `Ignored ${unknownIds.length} answer(s) for unrecognised ids: ${unknownIds
        .slice(0, 5)
        .join(", ")}.`
    )
  }

  if (Object.keys(answers).length === 0) {
    throw new Error("the model returned no usable answers")
  }

  return { answers, warnings }
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
): Promise<{ answers: AnswerMap; mode: string; warnings: string[] }> {
  const items = promptItems(questions)
  const prompt = buildPrompt(items)

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
      const mapped = toAnswerMap(JSON.parse(extractJson(content)), items)

      const missing = items.filter((item) => !(String(item.question.qno) in mapped.answers))
      if (missing.length > 0) {
        mapped.warnings.push(
          `No answer returned for ${missing.length} question(s); those default to option "a".`
        )
      }

      return { ...mapped, mode: attempt.mode }
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
