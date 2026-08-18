"use client"

import { LogOutIcon } from "lucide-react"

import { logout } from "@/app/login/actions"
import { Button } from "@/components/ui/button"

export function LogoutButton() {
  return (
    <form action={logout} className="w-full">
      <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">
        <LogOutIcon data-icon="inline-start" />
        Sign out
      </Button>
    </form>
  )
}
