"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { PlayIcon, SettingsIcon } from "lucide-react"
import { toast } from "sonner"

import { AppSidebar } from "@/components/app-sidebar"
import type { ConnectionState } from "@/components/connection-status"
import { CourseGrid } from "@/components/course-grid"
import { QuizList } from "@/components/quiz-list"
import { SiteHeader } from "@/components/site-header"
import { SolverTerminal } from "@/components/solver-terminal"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { isConfigured, useCredentials } from "@/hooks/use-credentials"
import { useSolver } from "@/hooks/use-solver"
import { fetchCourses, fetchQuizzes, fetchStatus, isFinished } from "@/lib/client-api"
import type { Course, Creds, Quiz } from "@/lib/types"

/** `?course=<id>` is the open course. Keeping it in the URL is what lets the
 * browser's back/forward buttons move between the two levels. */
function useCourseParam(): number | null {
  const id = Number(useSearchParams().get("course"))
  return Number.isInteger(id) && id > 0 ? id : null
}

/** Never throws: a failure is reported and comes back as an empty list. */
async function loadQuizzes(id: number, creds: Creds): Promise<Quiz[]> {
  try {
    return await fetchQuizzes(creds, id)
  } catch (error) {
    toast.error("Could not load quizzes", {
      description: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

export default function DashboardPage() {
  const { credentials, loaded, save } = useCredentials()
  const router = useRouter()
  const courseId = useCourseParam()

  const [connection, setConnection] = React.useState<ConnectionState>("idle")
  const [courses, setCourses] = React.useState<Course[]>([])
  const [coursesLoading, setCoursesLoading] = React.useState(false)
  // Keyed by course, so a response that lands after the user has moved on only
  // fills its own slot. A missing key means "not loaded yet".
  const [quizzesByCourse, setQuizzesByCourse] = React.useState<
    Record<number, Quiz[]>
  >({})

  const configured = isConfigured(credentials)
  const connected = connection === "connected"
  const selectedCourse =
    courseId === null ? null : (courses.find((course) => course.id === courseId) ?? null)
  // Until the course list arrives (e.g. a reload on `?course=`) only the id is known.
  const courseName = selectedCourse?.fullname ?? `Course ${courseId}`
  const quizzes = (courseId !== null && quizzesByCourse[courseId]) || []
  const quizzesLoading =
    connected && courseId !== null && !(courseId in quizzesByCourse)

  const storeQuizzes = React.useCallback((id: number, list: Quiz[]) => {
    setQuizzesByCourse((current) => ({ ...current, [id]: list }))
  }, [])

  /** Drop the cached list (showing the loading state) and fetch it again. */
  function reloadQuizzesFor(id: number) {
    setQuizzesByCourse((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    void loadQuizzes(id, credentials).then((list) => storeQuizzes(id, list))
  }

  const refresh = React.useCallback(async (creds: Creds) => {
    if (!isConfigured(creds)) {
      setConnection("idle")
      return
    }

    setConnection("checking")
    const status = await fetchStatus(creds)
    if (!status.authenticated) {
      setConnection(status.error ? "error" : "disconnected")
      setCourses([])
      setQuizzesByCourse({})
      if (status.error) {
        toast.error("Moodle authentication failed", { description: status.error })
      }
      return
    }
    setConnection("connected")

    setCoursesLoading(true)
    try {
      setCourses(await fetchCourses(creds))
    } catch (error) {
      setCourses([])
      toast.error("Could not load courses", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setCoursesLoading(false)
    }
  }, [])

  // Nothing may run before localStorage has been read.
  React.useEffect(() => {
    if (!loaded) return
    void refresh(credentials)
  }, [loaded, credentials, refresh])

  // Entering a course — by click, back/forward or a reload — loads its quizzes.
  React.useEffect(() => {
    if (!connected || courseId === null) return
    void loadQuizzes(courseId, credentials).then((list) => storeQuizzes(courseId, list))
  }, [connected, courseId, credentials, storeQuizzes])

  // Reloading the quiz list after a solve run needs the latest selection
  // without making the solver hook depend on it.
  const reloadQuizzes = React.useRef<() => void>(() => {})
  reloadQuizzes.current = () => {
    if (courseId !== null) reloadQuizzesFor(courseId)
  }

  const solver = useSolver(
    credentials,
    React.useCallback(() => reloadQuizzes.current(), [])
  )

  function handleSave(next: Creds) {
    save(next)
    setQuizzesByCourse({})
    // New credentials may be a different account — start again from the top.
    if (courseId !== null) router.push("/dashboard")
  }

  function handleSelectCourse(course: Course) {
    router.push(`/dashboard?course=${course.id}`)
  }

  const pending = quizzes.filter((quiz) => !isFinished(quiz))
  const busy = solver.state.running
  const canSolve = Boolean(credentials.groqApiKey)

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 80)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar
        variant="inset"
        credentials={credentials}
        connection={connection}
        onSave={handleSave}
      />
      <SidebarInset>
        <SiteHeader
          title={
            <Breadcrumb>
              <BreadcrumbList className="flex-nowrap">
                <BreadcrumbItem>
                  {courseId === null ? (
                    <BreadcrumbPage className="font-medium">Courses</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink render={<Link href="/dashboard" />}>
                      Courses
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {courseId !== null ? (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem className="min-w-0">
                      <BreadcrumbPage className="truncate font-medium">
                        {courseName}
                      </BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                ) : null}
              </BreadcrumbList>
            </Breadcrumb>
          }
          onRefresh={() =>
            courseId === null
              ? void refresh(credentials)
              : reloadQuizzesFor(courseId)
          }
          refreshing={connection === "checking" || coursesLoading || quizzesLoading}
        />

        <div className="@container/main flex flex-1 flex-col gap-6 p-4 lg:p-6">
          {!configured ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SettingsIcon />
                </EmptyMedia>
                <EmptyTitle>Add your Moodle connection</EmptyTitle>
                <EmptyDescription>
                  Fill in the URL, username and password in the sidebar. They stay in
                  this browser and are sent with each request.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : courseId === null ? (
            <section className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Courses</h2>
              <CourseGrid
                courses={courses}
                loading={coursesLoading}
                onSelect={handleSelectCourse}
              />
            </section>
          ) : (
            <section className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-col">
                  <h2 className="text-lg font-semibold">{courseName}</h2>
                  <p className="font-mono text-xs text-muted-foreground">
                    Course ID: {courseId}
                  </p>
                </div>
                {pending.length > 0 ? (
                  <Button
                    disabled={busy || !canSolve}
                    onClick={() => void solver.run(pending)}
                  >
                    <PlayIcon data-icon="inline-start" />
                    Solve all pending ({pending.length})
                  </Button>
                ) : null}
              </div>

              <QuizList
                quizzes={quizzes}
                loading={quizzesLoading}
                busy={busy || !canSolve}
                onSolve={(quiz) => void solver.run([quiz])}
              />

              {!canSolve ? (
                <p className="text-sm text-muted-foreground">
                  Add a Groq API key in the sidebar to enable solving.
                </p>
              ) : null}
            </section>
          )}
        </div>
      </SidebarInset>

      <SolverTerminal
        state={solver.state}
        onOpenChange={solver.setOpen}
        onAbort={solver.abort}
      />
    </SidebarProvider>
  )
}
