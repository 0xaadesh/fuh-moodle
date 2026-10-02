"use client"

import { LibraryIcon, SearchIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { isFinished } from "@/lib/client-api"
import type { Course, Quiz } from "@/lib/types"

export function CourseGrid({
  courses,
  loading,
  onSelect,
  quizzesByCourse,
  countsLoading,
  query,
  onQueryChange,
}: {
  courses: Course[]
  loading: boolean
  onSelect: (course: Course) => void
  quizzesByCourse: Record<number, Quiz[]>
  countsLoading: boolean
  query: string
  onQueryChange: (query: string) => void
}) {
  if (loading) {
    return (
      <div className="grid gap-4 @md/main:grid-cols-2 @4xl/main:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (courses.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LibraryIcon />
          </EmptyMedia>
          <EmptyTitle>No courses</EmptyTitle>
          <EmptyDescription>
            Nothing came back from Moodle for this account. Check the connection
            settings in the sidebar.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const needle = query.trim().toLowerCase()
  const visible = needle
    ? courses.filter(
        (course) =>
          course.fullname.toLowerCase().includes(needle) ||
          course.shortname.toLowerCase().includes(needle)
      )
    : courses

  return (
    <div className="flex flex-col gap-4">
      <div className="relative w-full max-w-sm">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search courses"
          aria-label="Search courses"
          className="pl-9"
        />
      </div>

      {visible.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>No matching courses</EmptyTitle>
            <EmptyDescription>
              Nothing matches &ldquo;{query.trim()}&rdquo;.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 @md/main:grid-cols-2 @4xl/main:grid-cols-3">
          {visible.map((course) => (
            <Card
              key={course.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(course)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  onSelect(course)
                }
              }}
              className="cursor-pointer transition-[transform,border-color] hover:-translate-y-0.5 hover:border-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
            >
              <CardHeader>
                <CardDescription className="font-mono text-xs">
                  {course.shortname}
                </CardDescription>
                <CardTitle className="text-base">{course.fullname}</CardTitle>
                <QuizCount
                  quizzes={quizzesByCourse[course.id]}
                  loading={countsLoading}
                />
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

/** "3 pending · 5 quizzes". Pending uses the same rule as "Solve all
 * pending", so the card and the course view always agree. */
function QuizCount({
  quizzes,
  loading,
}: {
  quizzes: Quiz[] | undefined
  loading: boolean
}) {
  // Same height as the badge row, so cards do not jump when counts arrive.
  if (!quizzes) return loading ? <Skeleton className="mt-1 h-5 w-28" /> : null

  if (quizzes.length === 0) {
    return <p className="mt-1 text-xs text-muted-foreground">No quizzes</p>
  }

  const pending = quizzes.filter((quiz) => !isFinished(quiz)).length
  return (
    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
      {/* Pending is what needs action, so it gets the accent; done recedes. */}
      {pending > 0 ? (
        <Badge>{pending} pending</Badge>
      ) : (
        <Badge variant="outline">All done</Badge>
      )}
      <span>
        {quizzes.length} {quizzes.length === 1 ? "quiz" : "quizzes"}
      </span>
    </div>
  )
}
