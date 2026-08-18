import Image from "next/image"
import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"

import { ModeToggle } from "@/components/mode-toggle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

/**
 * A grid fading into a soft halo behind the hero. Colours come from the theme
 * tokens, so it follows light/dark without any overrides, and the whole thing
 * is inert to pointers and hidden from assistive tech.
 */
function HeroBackground() {
  const gridMask =
    "radial-gradient(ellipse 75% 60% at 50% 35%, black 20%, transparent 75%)"

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: gridMask,
          WebkitMaskImage: gridMask,
        }}
      />
      <div
        className="absolute top-1/3 left-1/2 size-[44rem] max-w-[150vw] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20 blur-3xl"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--primary) 0%, transparent 65%)",
        }}
      />
    </div>
  )
}

export default function Home() {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <HeroBackground />
      <header className="relative flex items-center justify-between p-4 lg:p-6">
        <div className="flex items-center gap-2">
          <Image
            src="/favicon-96x96.png"
            alt=""
            width={96}
            height={96}
            className="size-6 rounded-sm"
            priority
          />
          <span className="font-semibold">fuh-moodle</span>
        </div>
        <ModeToggle />
      </header>

      <main className="relative flex flex-1 items-center justify-center px-6 py-16">
        <div className="flex max-w-2xl flex-col items-center gap-6 text-center">
          <Image
            src="/web-app-manifest-192x192.png"
            alt="fuh-moodle"
            width={192}
            height={192}
            className="size-20 rounded-2xl"
            priority
          />

          <div className="flex flex-col gap-4">
            <h1 className="text-5xl font-bold tracking-tight text-balance sm:text-6xl">
              fuh-moodle
            </h1>
            <p className="text-xl text-balance text-muted-foreground sm:text-2xl">
              Automate the boring, repetitive quizzes with AI. Sit back, relax.
            </p>
          </div>

          <p className="max-w-xl text-base text-pretty text-muted-foreground">
            Your professors have been recycling the same question bank since 2019.
            If they are not putting in the effort to write new quizzes, why are you
            the one losing sleep over solving them? Point it at your Moodle, hit
            solve, and go spend the evening on something that actually counts.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button size="lg" render={<Link href="/dashboard" />}>
              Open dashboard
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
            <Badge variant="outline">
              Credentials stay in your browser
            </Badge>
          </div>
        </div>
      </main>
    </div>
  )
}
