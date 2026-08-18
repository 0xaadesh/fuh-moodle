import { moodleRequest } from "@/lib/moodle/client"
import type { MoodleSession } from "@/lib/moodle/auth"
import type { Course } from "@/lib/types"

const METHOD = "core_course_get_enrolled_courses_by_timeline_classification"

/**
 * The only structured endpoint in the whole app: Moodle's internal AJAX
 * service, which speaks JSON and batches calls as an array.
 */
export async function getCourses({
  baseUrl,
  sesskey,
  jar,
}: MoodleSession): Promise<Course[]> {
  const url = `${baseUrl}/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}&info=${METHOD}`

  const { html } = await moodleRequest(jar, url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify([
      {
        index: 0,
        methodname: METHOD,
        args: {
          offset: 0,
          limit: 0, // unlimited
          classification: "all", // past, in-progress and future
          sort: "fullname",
        },
      },
    ]),
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(html)
  } catch {
    throw new Error("Unexpected response format from Moodle courses API.")
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Unexpected response format from Moodle courses API.")
  }

  const item = parsed[0] as {
    error?: unknown
    exception?: unknown
    data?: { courses?: Course[] }
  }
  if (item.error) {
    throw new Error(`Moodle AJAX API Error: ${JSON.stringify(item.exception)}`)
  }

  return (item.data?.courses ?? []).map((course) => ({
    id: course.id,
    fullname: course.fullname,
    shortname: course.shortname,
    viewurl: course.viewurl,
  }))
}
