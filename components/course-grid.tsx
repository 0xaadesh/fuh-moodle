"use client"

import { LibraryIcon } from "lucide-react"

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
import { Skeleton } from "@/components/ui/skeleton"
import type { Course } from "@/lib/types"

export function CourseGrid({
  courses,
  loading,
  onSelect,
}: {
  courses: Course[]
  loading: boolean
  onSelect: (course: Course) => void
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

  return (
    <div className="grid gap-4 @md/main:grid-cols-2 @4xl/main:grid-cols-3">
      {courses.map((course) => (
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
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}
