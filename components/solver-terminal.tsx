"use client"

import * as React from "react"
import { SparklesIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import type { LogTone, SolverState } from "@/hooks/use-solver"

const TONE_CLASS: Record<LogTone, string> = {
  default: "text-foreground",
  info: "text-muted-foreground",
  success: "text-primary",
  error: "text-destructive",
}

export function SolverTerminal({
  state,
  onOpenChange,
  onAbort,
}: {
  state: SolverState
  onOpenChange: (open: boolean) => void
  onAbort: () => void
}) {
  const logEndRef = React.useRef<HTMLDivElement>(null)

  // Follow the tail as lines arrive. "nearest" keeps the scroll inside the log
  // viewport instead of dragging the dialog around it.
  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "nearest" })
  }, [state.log])

  return (
    <Dialog open={state.open} onOpenChange={onOpenChange}>
      {/* flex + overflow-hidden so the popup owns the height budget: the
          question card scrolls internally and the footer stays reachable. */}
      <DialogContent
        className="flex max-h-[90svh] flex-col gap-4 overflow-hidden sm:max-w-3xl"
        showCloseButton={!state.running}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>Solving {state.quizName}</DialogTitle>
          <DialogDescription>
            {state.summary || "Waiting for the solver to start..."}
          </DialogDescription>
        </DialogHeader>

        {state.totalPages > 0 ? (
          <Progress
            className="shrink-0"
            value={(state.page / state.totalPages) * 100}
          >
            <ProgressLabel>Pages submitted</ProgressLabel>
            <ProgressValue
              render={
                <span>
                  {state.page} / {state.totalPages}
                </span>
              }
            />
          </Progress>
        ) : null}

        {state.thinking ? (
          <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Groq LLM is thinking&hellip;
          </div>
        ) : null}

        {/* The log is a fixed 8rem block and everything else takes what is
            left, so the height budget is deterministic rather than the result
            of competing flex ratios. min-h-0 is what lets a flex child shrink
            below its content height. The question stays pinned while the
            choices scroll under it. */}
        {state.focus ? (
          <Card className="min-h-0 flex-1">
            <CardHeader className="shrink-0">
              <CardDescription>Question {state.focus.qno}</CardDescription>
              <CardTitle className="text-base">{state.focus.question}</CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-2 p-0">
              <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-2 px-(--card-spacing)">
                  {state.focus.choices.map((choice) => {
                    const picked = choice.letter === state.selected
                    return (
                      <div
                        key={choice.letter}
                        className={cn(
                          "flex items-start gap-2 rounded-md border p-2 text-sm",
                          picked && "border-primary bg-primary/10"
                        )}
                      >
                        <Badge variant={picked ? "default" : "outline"}>
                          {choice.letter}
                        </Badge>
                        <span className="flex-1">{choice.text}</span>
                        {picked ? (
                          <SparklesIcon
                            className="size-4 text-primary"
                            aria-hidden
                          />
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        ) : null}

        <ScrollArea className="h-32 shrink-0 overflow-hidden rounded-lg border bg-muted/40">
          <div className="flex flex-col gap-1 p-3 font-mono text-xs">
            {state.log.map((entry) => (
              <p key={entry.id} className={TONE_CLASS[entry.tone]}>
                <span className="text-muted-foreground">[{entry.time}]</span>{" "}
                {entry.message}
              </p>
            ))}
            <div ref={logEndRef} />
          </div>
        </ScrollArea>

        <DialogFooter className="shrink-0">
          {state.running ? (
            <Button variant="destructive" onClick={onAbort}>
              Cancel run
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={state.running}
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
