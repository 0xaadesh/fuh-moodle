"use client"

import { CheckIcon, FileQuestionIcon, PlayIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { isFinished, statusTone } from "@/lib/client-api"
import type { Quiz } from "@/lib/types"

function StatusBadge({ status }: { status: string }) {
  const tone = statusTone(status)
  if (tone === "finished") return <Badge>Finished</Badge>
  if (tone === "in-progress") return <Badge variant="secondary">In progress</Badge>
  // Anything unrecognised — including scrape errors — reads as not attempted,
  // but the raw string is kept so an error is still visible.
  return <Badge variant="outline">{status || "Not attempted"}</Badge>
}

export function QuizList({
  quizzes,
  loading,
  busy,
  onSolve,
}: {
  quizzes: Quiz[]
  loading: boolean
  busy: boolean
  onSolve: (quiz: Quiz) => void
}) {
  if (loading) {
    return (
      <ItemGroup>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-16 w-full rounded-lg" />
        ))}
      </ItemGroup>
    )
  }

  if (quizzes.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileQuestionIcon />
          </EmptyMedia>
          <EmptyTitle>No quizzes in this course</EmptyTitle>
          <EmptyDescription>
            Only activities linking to <code>mod/quiz</code> are listed.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ItemGroup>
      {quizzes.map((quiz) => {
        const finished = isFinished(quiz)
        const { marks, grade } = quiz.status

        return (
          <Item key={quiz.id} variant="outline">
            <ItemContent>
              <ItemTitle>{quiz.name}</ItemTitle>
              <ItemDescription className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">Module ID: {quiz.id}</span>
                <StatusBadge status={quiz.status.status} />
                {marks ? <span>Marks: {marks}</span> : null}
                {grade ? <span>({grade})</span> : null}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              {finished ? (
                <Button size="sm" variant="ghost" disabled>
                  <CheckIcon data-icon="inline-start" />
                  Finished
                </Button>
              ) : (
                <Button size="sm" disabled={busy} onClick={() => onSolve(quiz)}>
                  <PlayIcon data-icon="inline-start" />
                  Solve
                </Button>
              )}
            </ItemActions>
          </Item>
        )
      })}
    </ItemGroup>
  )
}
