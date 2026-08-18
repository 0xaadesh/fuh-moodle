import Image from "next/image"
import { redirect } from "next/navigation"

import { LoginForm } from "@/components/login-form"
import { currentUser } from "@/lib/auth"

export default async function Page({ searchParams }: PageProps<"/login">) {
  // Already signed in — no reason to show the form again.
  if (await currentUser()) redirect("/dashboard")

  const { next } = await searchParams
  const target = typeof next === "string" ? next : undefined

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-center gap-2">
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
        <LoginForm next={target} />
      </div>
    </div>
  )
}
