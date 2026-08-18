"use client"

import * as React from "react"
import { PlayIcon, SettingsIcon } from "lucide-react"
import { toast } from "sonner"

import { AppSidebar } from "@/components/app-sidebar"
import type { ConnectionState } from "@/components/connection-status"
import { CourseGrid } from "@/components/course-grid"
import { QuizList } from "@/components/quiz-list"
import { SiteHeader } from "@/components/site-header"
import { SolverTerminal } from "@/components/solver-terminal"
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

export default function DashboardPage() {
  const { credentials, loaded, save } = useCredentials()

  const [connection, setConnection] = React.useState<ConnectionState>("idle")
  const [courses, setCourses] = React.useState<Course[]>([])
  const [coursesLoading, setCoursesLoading] = React.useState(false)
  const [selectedCourse, setSelectedCourse] = React.useState<Course | null>(null)
  const [quizzes, setQuizzes] = React.useState<Quiz[]>([])
  const [quizzesLoading, setQuizzesLoading] = React.useState(false)

  const configured = isConfigured(credentials)

  const loadQuizzes = React.useCallback(
    async (course: Course, creds: Creds) => {
      setQuizzesLoading(true)
      try {
        setQuizzes(await fetchQuizzes(creds, course.id))
      } catch (error) {
        setQuizzes([])
        toast.error("Could not load quizzes", {
          description: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setQuizzesLoading(false)
      }
    },
    []
  )

  const refresh = React.useCallback(
    async (creds: Creds, course: Course | null) => {
      if (!isConfigured(creds)) {
        setConnection("idle")
        return
      }

      setConnection("checking")
      const status = await fetchStatus(creds)
      if (!status.authenticated) {
        setConnection(status.error ? "error" : "disconnected")
        setCourses([])
        setQuizzes([])
        if (status.error) {
          toast.error("Moodle authentication failed", { description: status.error })
        }
        return
      }
      setConnection("connected")

      if (course) {
        await loadQuizzes(course, creds)
        return
      }

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
    },
    [loadQuizzes]
  )

  // Nothing may run before localStorage has been read.
  React.useEffect(() => {
    if (!loaded) return
    void refresh(credentials, null)
  }, [loaded, credentials, refresh])

  // Reloading the quiz list after a solve run needs the latest selection
  // without making the solver hook depend on it.
  const reloadQuizzes = React.useRef<() => void>(() => {})
  reloadQuizzes.current = () => {
    if (selectedCourse) void loadQuizzes(selectedCourse, credentials)
  }

  const solver = useSolver(
    credentials,
    React.useCallback(() => reloadQuizzes.current(), [])
  )

  function handleSave(next: Creds) {
    save(next)
    setSelectedCourse(null)
    setQuizzes([])
  }

  function handleSelectCourse(course: Course) {
    setSelectedCourse(course)
    void loadQuizzes(course, credentials)
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
          title={selectedCourse ? selectedCourse.fullname : "Courses"}
          onRefresh={() => void refresh(credentials, selectedCourse)}
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
          ) : (
            <>
              <section className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">Courses</h2>
                  {selectedCourse ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedCourse(null)
                        setQuizzes([])
                      }}
                    >
                      Clear selection
                    </Button>
                  ) : null}
                </div>
                <CourseGrid
                  courses={courses}
                  loading={coursesLoading}
                  selectedId={selectedCourse?.id ?? null}
                  onSelect={handleSelectCourse}
                />
              </section>

              {selectedCourse ? (
                <section className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <h2 className="text-lg font-semibold">
                        {selectedCourse.fullname}
                      </h2>
                      <p className="font-mono text-xs text-muted-foreground">
                        Course ID: {selectedCourse.id}
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
              ) : null}
            </>
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
